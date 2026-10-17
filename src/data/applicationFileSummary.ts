export function applicationFileSummary(count?: number, firstName?: string | null): string {
  if (!Number.isInteger(count) || count! < 0) return 'Application file information is unavailable.';
  if (count === 0) return 'No files were uploaded with this application.';
  if (!firstName) return `${count} application ${count === 1 ? 'file' : 'files'} uploaded.`;
  return count === 1 ? firstName : `${firstName} + ${count! - 1} other ${count === 2 ? 'file' : 'files'}`;
}
