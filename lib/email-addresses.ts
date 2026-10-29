// Created by Cory McCabe
const taskAddresses = ['tasks@followthrough.link', 'tasks@followthrough.site'];

// Both owned addresses identify the same connected mailbox. Preserve the
// stored primary address until sending and receiving are verified at cutover.
export function emailAddressAliases(value: string): string[] {
  const address = value.trim().toLowerCase();
  return taskAddresses.includes(address)
    ? [address, ...taskAddresses.filter((candidate) => candidate !== address)]
    : [address];
}
