import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEventLog, createIdentity } from '@dokima/events';
import { claimTicket, createTicket } from '@dokima/tickets';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WsHub, type HubSocket } from '../ws-hub.js';
import { createBoardWatcher } from './board-watcher.js';

/**
 * W10-75. `wsHub.publish` had ONE call site in the whole server — inside the
 * ticket-verb route — so the board moved on screen only when the founder's own
 * browser moved it. Measured with a Canvas open: a ticket closed from the CLI
 * sat in "In Progress" until a reload.
 *
 * Every case here writes to the event log DIRECTLY, never through the verb
 * route, because that is exactly what the CLI, the harbormaster loop and a
 * spawned session do. A test that called `publish()` itself would pass against
 * the broken code and prove nothing.
 */
describe('the board is a projection of the event log, not of one HTTP handler (W10-75)', () => {
  const dirs: string[] = [];
  const hubs: WsHub[] = [];

  afterEach(async () => {
    for (const hub of hubs.splice(0)) hub.close();
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  function fakeSocket(): {
    socket: HubSocket;
    sent: string[];
    subscribe: (topic: string) => void;
  } {
    const sent: string[] = [];
    const listeners = new Map<string, (data?: unknown) => void>();
    const socket: HubSocket = {
      readyState: 1,
      OPEN: 1,
      send: (data: string) => sent.push(data),
      ping: () => undefined,
      terminate: () => undefined,
      on: (event: string, listener: (data?: unknown) => void) => {
        listeners.set(event, listener);
      },
    } as unknown as HubSocket;
    return {
      socket,
      sent,
      // Drives the REAL subscribe path (the hub's own message handler), rather
      // than reaching into private state — the same frame `ws-client.ts` sends.
      subscribe: (topic: string) =>
        listeners.get('message')?.(
          Buffer.from(JSON.stringify({ op: 'subscribe', subscriptions: [topic] })),
        ),
    };
  }

  async function scenario() {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-w1075-'));
    dirs.push(home);
    const projectId = 'proj-watch';
    const projectPath = path.join(home, 'product');
    await fs.mkdir(path.join(projectPath, '.dokima'), { recursive: true });
    const registryPath = path.join(home, 'fleet.json');
    await fs.writeFile(
      registryPath,
      JSON.stringify([{ id: projectId, path: projectPath, name: 'Watched' }]),
    );

    const log = openEventLog(path.join(projectPath, '.dokima', 'state.db'));
    createIdentity(log, { id: 'worker-1', name: 'worker-1', kind: 'machine' });
    createTicket(log, 'worker-1', {
      id: 'T-1',
      type: 'task',
      title: 'A ticket something else will move',
      lane: 'core',
      writeScope: ['src/**'],
      verify: 'true',
    });

    const hub = new WsHub();
    hubs.push(hub);
    hub.start();
    const { socket, sent, subscribe } = fakeSocket();
    hub.handleConnection(socket);
    subscribe(`board:${projectId}`);

    const watcher = createBoardWatcher({ wsHub: hub, registryPath });
    return { hub, watcher, log, sent, projectId };
  }

  it('RED FIXTURE: a transition written OUTSIDE the verb route reaches a subscribed client', async () => {
    const { watcher, log, sent } = await scenario();

    // Baseline pass: the client already has the board over REST, so the first
    // tick must not replay it.
    await watcher.tick();
    const afterBaseline = sent.length;

    // THE WRITE THE PRODUCT ACTUALLY MAKES: straight to the log, no HTTP.
    claimTicket(log, { ticketId: 'T-1', actorId: 'worker-1' });
    log.close();

    await watcher.tick();

    const delivered = sent.slice(afterBaseline).map(
      (raw) =>
        JSON.parse(raw) as {
          type: string;
          data: { id: string; status: string };
        },
    );
    expect(delivered.length).toBeGreaterThan(0);
    const claimed = delivered.find((e) => e.data.id === 'T-1');
    expect(claimed?.type).toMatch(/^ticket\./);
    expect(claimed?.data.status).toBe('claimed');
  });

  it('publishes nothing when the log has not moved — the replay buffer stays for real deltas', async () => {
    const { watcher, log, sent } = await scenario();
    log.close();

    await watcher.tick();
    const afterBaseline = sent.length;
    await watcher.tick();
    await watcher.tick();

    // Republishing unchanged rows would inflate the hub's per-subscription seq
    // and push real deltas out of the 200-envelope buffer `resume` depends on.
    expect(sent.length).toBe(afterBaseline);
  });

  it('polls only what someone is watching, and stops when they leave', async () => {
    const { hub, watcher, log } = await scenario();
    log.close();
    const spy = vi.spyOn(hub, 'publish');

    hub.close(); // every socket gone -> no active subscriptions
    await watcher.tick();

    expect(spy).not.toHaveBeenCalled();
  });
});
