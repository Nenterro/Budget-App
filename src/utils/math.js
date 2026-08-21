// Amount fields accept small arithmetic expressions ("1200+350", "40*3").
//
// This used to be evaluated with `new Function('return ' + input)`, guarded only
// by a character whitelist. The whitelist held, but handing user text to the JS
// engine is a sharp edge that does not need to exist for four operators — and
// it also meant things like `1/0` or `()` came back as Infinity/undefined
// rather than as a clean "not a number".
//
// Grammar:
//   expression := term (('+' | '-') term)*
//   term       := factor (('*' | '/') factor)*
//   factor     := ('+' | '-') factor | '(' expression ')' | number
//
// Returns a finite number, or null if the input is not a complete valid
// expression. Commas are treated as digit grouping and ignored.
export function evalMath(input) {
  if (input === null || input === undefined) return null;
  const src = String(input).replace(/,/g, '').trim();
  if (!src) return null;

  let pos = 0;

  const skipSpace = () => {
    while (pos < src.length && src[pos] === ' ') pos++;
  };

  const peek = () => {
    skipSpace();
    return pos < src.length ? src[pos] : null;
  };

  // Thrown for any malformed input and caught once at the bottom.
  const fail = () => {
    throw new SyntaxError('bad expression');
  };

  function parseFactor() {
    const ch = peek();
    if (ch === null) fail();

    if (ch === '+' || ch === '-') {
      pos++;
      const value = parseFactor();
      return ch === '-' ? -value : value;
    }

    if (ch === '(') {
      pos++;
      const value = parseExpression();
      if (peek() !== ')') fail();
      pos++;
      return value;
    }

    const start = pos;
    while (pos < src.length && src[pos] >= '0' && src[pos] <= '9') pos++;
    if (src[pos] === '.') {
      pos++;
      while (pos < src.length && src[pos] >= '0' && src[pos] <= '9') pos++;
    }
    if (pos === start) fail();

    const value = Number(src.slice(start, pos));
    if (!Number.isFinite(value)) fail();
    return value;
  }

  function parseTerm() {
    let value = parseFactor();
    for (;;) {
      const ch = peek();
      if (ch !== '*' && ch !== '/') return value;
      pos++;
      const rhs = parseFactor();
      // Division by zero would otherwise produce Infinity and sail through as
      // a "valid" amount.
      if (ch === '/' && rhs === 0) fail();
      value = ch === '*' ? value * rhs : value / rhs;
    }
  }

  function parseExpression() {
    let value = parseTerm();
    for (;;) {
      const ch = peek();
      if (ch !== '+' && ch !== '-') return value;
      pos++;
      const rhs = parseTerm();
      value = ch === '+' ? value + rhs : value - rhs;
    }
  }

  try {
    const result = parseExpression();
    // Anything left over means the input was only partly an expression.
    if (peek() !== null) return null;
    return Number.isFinite(result) ? result : null;
  } catch (e) {
    return null;
  }
}
