function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const segments = text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]+/gu) ?? [];

  for (const segment of segments) {
    if (/^[\u4e00-\u9fa5]+$/u.test(segment)) {
      const characters = Array.from(segment);
      for (let index = 0; index < characters.length - 1; index += 1) {
        tokens.add(`${characters[index]}${characters[index + 1]}`);
      }
    } else if (segment.length > 1) {
      tokens.add(segment);
    }
  }

  return tokens;
}

export function calculateLexicalSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const union = new Set([...leftTokens, ...rightTokens]);

  if (union.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersectionSize += 1;
  }

  return intersectionSize / union.size;
}
