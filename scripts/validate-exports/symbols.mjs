// Chapter of `validate-exports.mjs` (W22-02 split): what a package publishes,
// what a module declares, and what an author has explicitly excused.
import ts from 'typescript';

/**
 * Public surface of one package: the symbols a consumer can actually import.
 * Resolved through the checker so `export * from './packer/index.js'` yields
 * the symbols behind it — the exact case W12-04 turned on.
 */
export function exportsOfBarrel(barrelPath) {
  const program = ts.createProgram([barrelPath], {
    allowJs: false,
    noEmit: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(barrelPath);
  if (!source) return [];
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [];
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      // VALUE EXPORTS ONLY, and this is the calibration that makes the check
      // usable rather than noise. The first run reported 529 findings —
      // instantly waivable, which is how a validator dies. The overwhelming
      // majority were interfaces and type aliases, and a type nobody names is
      // harmless: it costs nothing at runtime and disappears at compile time.
      // A FUNCTION nobody calls is dead code. That is the defect class, so
      // that is what this reports. `ts.SymbolFlags.Value` is the distinction,
      // taken from the checker rather than guessed from the name.
      const flags = symbol.getFlags();
      const resolved =
        flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return (resolved.getFlags() & ts.SymbolFlags.Value) !== 0;
    })
    .map((symbol) => {
      const resolved =
        symbol.getFlags() & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declaration = resolved.declarations?.[0];
      return {
        name: symbol.getName(),
        declFile: declaration ? declaration.getSourceFile().fileName : null,
      };
    })
    .filter(
      (entry) =>
        entry.name !== 'default' &&
        // Every package declares one as a scaffold marker; being uncalled is
        // its entire nature, so reporting all twelve is pure noise.
        entry.name !== 'PACKAGE_NAME' &&
        /^[A-Za-z_$][\w$]*$/.test(entry.name),
    );
}

export function moduleExports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const names = [];
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    // `export default` has no name to search for, and re-export statements
    // (`export { x } from ...`) are plumbing, same as a barrel.
    if (modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        // VALUE exports only, matching the barrel pass's calibration: a type
        // nobody names costs nothing at runtime; a function nobody calls is
        // dead code.
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
      }
    }
  }
  return names;
}

/**
 * `@unreached <Symbol>: <reason>` — a deliberate non-caller, on the record.
 *
 * Some exports are genuinely reached by nothing and should stay: a documented
 * escape hatch, a capability withheld until the ticket that consumes it, a
 * symbol kept for a published API. Before this, the only way to quiet the
 * validator was to raise a baseline, which loses the DISTINCTION — deliberate
 * and accidental became the same number.
 *
 * An inline marker rather than a JSON allowlist, for the reason P11 in
 * `validate-plan.mjs` gives in this repo's own voice: a separate list drifts
 * from the thing it describes the moment either moves, while a marker beside
 * the export is reviewed in the same diff and deleted by the same hand that
 * finally wires the symbol up.
 *
 * NAMING THE SYMBOL IN THE MARKER IS SAFE, and that is not an accident of
 * syntax — `countReferences` strips comments (W12-39), so the marker cannot
 * register as a reference to the thing it exempts. Were that not true this
 * marker would appear to work while actually suppressing through the wrong
 * mechanism, with no reason recorded anywhere: a false negative dressed as a
 * decision. There is a fixture for exactly that.
 *
 * A REASON IS REQUIRED. A marker without one does not suppress and is reported
 * as malformed, because "someone once decided this" with no record of why is
 * the prose-intent-as-control the whole validator exists to replace.
 */
export function unreachedMarkers(text) {
  const markers = new Map();
  const malformed = [];
  // ANCHORED TO THE START OF A COMMENT LINE, not matched anywhere in the text.
  // Found the hard way: the first draft scanned freely and immediately
  // "found" a marker in this very file's own prose — the sentence explaining
  // that `@unreached Foo` with no reason is refused parsed AS an @unreached
  // with no reason, and the validator failed on its own documentation. A
  // discussion of a marker is not a marker.
  const pattern = /^[ \t]*(?:\/\/|\*|\/\*\*?)?[ \t]*@unreached[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*(?::[ \t]*(.*))?$/;
  for (const line of text.split('\n')) {
    const match = pattern.exec(line);
    if (!match) continue;
    const symbol = match[1];
    const reason = (match[2] ?? '').replace(/\*\/\s*$/, '').trim();
    if (reason.length === 0) malformed.push(symbol);
    else markers.set(symbol, reason);
  }
  return { markers, malformed };
}
