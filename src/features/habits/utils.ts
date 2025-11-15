export function getNextOrder(prev?: number, next?: number) {
  if (typeof prev === 'number' && typeof next === 'number') {
    return Number(((prev + next) / 2).toFixed(4));
  }

  if (typeof prev === 'number') {
    return Number((prev + 1).toFixed(4));
  }

  if (typeof next === 'number') {
    return Number((next - 1).toFixed(4));
  }

  return 0;
}
