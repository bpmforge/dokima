import { describe, expect, it } from 'vitest';
import { ProviderResponseShapeError, ProviderUnsupportedRoleError } from './errors.js';
import type { CostTable } from './usage.js';
import {
  buildCountTokensBody,
  buildGenerateContentBody,
  parseCountTokensResponse,
  parseGenerateContentResponse,
} from './vertex-chat.js';
import {
  countTokensSuccessFixture,
  generateContentSafetyFixture,
  generateContentSuccessFixture,
  generateContentTruncatedFixture,
} from './vertex-fixtures.js';

const SAMPLE_COST: CostTable = {
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
};

describe('buildGenerateContentBody', () => {
  it('maps assistant/user roles to Gemini model/user and lifts system messages out', () => {
    const body = buildGenerateContentBody({
      model: 'gemini-2.5-pro',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });

    expect(body).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
      ],
      systemInstruction: { parts: [{ text: 'Be concise.' }] },
    });
  });

  it('carries temperature/maxTokens/stop into generationConfig', () => {
    const body = buildGenerateContentBody({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      maxTokens: 512,
      stop: ['STOP'],
    });

    expect(body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        stopSequences: ['STOP'],
      },
    });
  });

  it('omits systemInstruction/generationConfig when unused', () => {
    const body = buildGenerateContentBody({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body).toEqual({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
  });

  it('RED FIXTURE: refuses a tool-role message with ProviderUnsupportedRoleError instead of mis-serializing it (W11-15, FR-G9)', () => {
    let err: unknown;
    try {
      buildGenerateContentBody({
        model: 'gemini-2.5-pro',
        messages: [
          { role: 'user', content: 'what is the weather in NYC?' },
          { role: 'tool', content: '72F and sunny' },
        ],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderUnsupportedRoleError);
    expect((err as InstanceType<typeof ProviderUnsupportedRoleError>).adapter).toBe(
      'vertex',
    );
    expect((err as InstanceType<typeof ProviderUnsupportedRoleError>).role).toBe('tool');
  });
});

describe('parseGenerateContentResponse', () => {
  it('parses a successful completion into a normalized ChatResponse', () => {
    const response = parseGenerateContentResponse(
      'vertex',
      'gemini-2.5-pro',
      generateContentSuccessFixture,
      SAMPLE_COST,
    );
    expect(response).toEqual({
      model: 'gemini-2.5-pro',
      message: { role: 'assistant', content: 'Hello! How can I help you today?' },
      finishReason: 'stop',
      usage: {
        promptTokens: 12,
        completionTokens: 9,
        totalTokens: 21,
        costUsd: (12 / 1_000_000) * 1.25 + (9 / 1_000_000) * 5,
      },
    });
  });

  it('maps MAX_TOKENS to length', () => {
    const response = parseGenerateContentResponse(
      'vertex',
      'gemini-2.5-pro',
      generateContentTruncatedFixture,
      SAMPLE_COST,
    );
    expect(response.finishReason).toBe('length');
  });

  it('maps SAFETY to content_filter', () => {
    const response = parseGenerateContentResponse(
      'vertex',
      'gemini-2.5-pro',
      generateContentSafetyFixture,
      SAMPLE_COST,
    );
    expect(response.finishReason).toBe('content_filter');
  });

  it('throws ProviderResponseShapeError when candidates is empty', () => {
    expect(() =>
      parseGenerateContentResponse(
        'vertex',
        'gemini-2.5-pro',
        { candidates: [] },
        SAMPLE_COST,
      ),
    ).toThrow(ProviderResponseShapeError);
  });

  it('throws ProviderResponseShapeError when usageMetadata is missing — never silently metered as zero', () => {
    expect(() =>
      parseGenerateContentResponse(
        'vertex',
        'gemini-2.5-pro',
        { candidates: generateContentSuccessFixture.candidates },
        SAMPLE_COST,
      ),
    ).toThrow(ProviderResponseShapeError);
  });
});

describe('countTokens wire helpers', () => {
  it('builds a minimal single-message request body', () => {
    expect(buildCountTokensBody()).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    });
  });

  it('parses totalTokens from the response', () => {
    expect(parseCountTokensResponse('vertex', countTokensSuccessFixture)).toBe(3);
  });

  it('throws ProviderResponseShapeError when totalTokens is missing', () => {
    expect(() => parseCountTokensResponse('vertex', {})).toThrow(
      ProviderResponseShapeError,
    );
  });
});
