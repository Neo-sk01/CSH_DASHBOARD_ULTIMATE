import { openWarehouse, type SnapshotRow, type PullRunRow } from './client'

let cached: ReturnType<typeof openWarehouse> | null = null

function reader() {
  if (!cached) cached = openWarehouse({ mode: 'read' })
  return cached
}

export async function getSnapshot(args: {
  period: SnapshotRow['period']
  periodStart: string
  includeWeekends: boolean
}): Promise<SnapshotRow | null> {
  const w = await reader()
  return w.getSnapshot(args)
}

export async function getMostRecentFinalizedDay(): Promise<Date | string | null> {
  const w = await reader()
  return w.getMostRecentFinalizedDay()
}

export async function getLatestSuccessfulPull(): Promise<PullRunRow | null> {
  const w = await reader()
  return w.getLatestSuccessfulPull()
}

export async function getRecentPullRuns(limit = 20): Promise<PullRunRow[]> {
  const w = await reader()
  return w.getRecentPullRuns(limit)
}
