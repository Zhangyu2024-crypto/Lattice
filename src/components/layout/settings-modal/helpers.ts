// Formatters shared by SettingsModal tabs. Kept separate so the modal
// shell stays focused on layout + state wiring.

export function summariseHealth(result: {
  python_version?: string | null
  lammps_available?: boolean
  cp2k_available?: boolean
  packages?: Record<string, string>
}) {
  const bits: string[] = []
  if (result.python_version) bits.push(`Python ${result.python_version}`)
  if (result.lammps_available) bits.push('LAMMPS')
  if (result.cp2k_available) bits.push('CP2K')
  const pkgCount = result.packages ? Object.keys(result.packages).length : 0
  if (pkgCount) bits.push(`${pkgCount} packages`)
  return bits.length > 0 ? `Compute ready (${bits.join(' · ')})` : 'Compute ready'
}
