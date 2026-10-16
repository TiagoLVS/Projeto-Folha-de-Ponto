export type NetworkLock = { locked: boolean; unavailable: boolean; checked: boolean };
const initial: NetworkLock = { locked: false, unavailable: false, checked: false };
let snapshot = initial;
const listeners = new Set<() => void>();
export const getNetworkLock = () => snapshot;
export const getServerNetworkLock = () => initial;
export function subscribeNetworkLock(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setNetworkLock(next: NetworkLock) {
  if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}
export function mutationsBlocked() {
  return snapshot.locked || snapshot.unavailable;
}
