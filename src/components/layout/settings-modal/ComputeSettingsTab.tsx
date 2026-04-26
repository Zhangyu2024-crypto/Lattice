import {
  COMPUTE_TIMEOUT_MAX_SEC,
  useComputeConfigStore,
  type ComputeMode,
} from '../../../stores/compute-config-store'
import ComputeResources from '../ComputeResources'
import { Field, Section } from './primitives'

// Compute tab of the settings modal. Owns no state itself — the parent
// modal hands down the live store snapshot plus the test handler so the
// handler can close over session / toast context.
//
// Scope: Native (bundled conda env) and Disabled only. Docker (Local /
// Remote) modes were removed in v5 — the app's compute workload is fully
// covered by the bundled scientific stack.

const MODES: ComputeMode[] = ['disabled', 'native']

function modeLabel(mode: ComputeMode): string {
  switch (mode) {
    case 'disabled':
      return 'Disabled'
    case 'native':
      return 'Native (recommended)'
  }
}

export default function ComputeSettingsTab({
  compute,
  testing,
  onTestCompute,
}: {
  compute: ReturnType<typeof useComputeConfigStore.getState>
  testing: boolean
  onTestCompute: () => void
}) {
  return (
    <Section title="Compute Environment">
      <div className="settings-modal-compute-intro">
        <strong>Native</strong> runs on the bundled Python scientific stack
        (LAMMPS, CP2K, phonopy, BGMN, ASE, PySCF, pymatgen). No setup
        required — Lattice spawns the tool directly in a managed conda
        environment.
      </div>

      <Field label="Mode">
        <div className="settings-modal-mode-row">
          {MODES.map((mode) => (
            <label key={mode} className="settings-modal-mode-label">
              <input
                type="radio"
                checked={compute.mode === mode}
                onChange={() => compute.setMode(mode)}
                className="settings-modal-mode-radio"
              />
              {modeLabel(mode)}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Timeout (s)">
        <input
          type="number"
          min={1}
          max={COMPUTE_TIMEOUT_MAX_SEC}
          value={compute.timeoutSec}
          onChange={(e) => compute.setTimeoutSec(Number(e.target.value))}
          className="settings-modal-input"
        />
      </Field>

      {compute.mode === 'native' && <ComputeResources />}

      <div className="settings-modal-test-row">
        <button
          type="button"
          onClick={onTestCompute}
          disabled={testing || compute.mode === 'disabled'}
          className="settings-modal-btn-primary settings-modal-test-btn"
        >
          {testing ? 'Probing…' : 'Test connection'}
        </button>
        {compute.lastTest && (
          <span
            className={`settings-modal-test-status${compute.lastTest.ok ? ' is-ok' : ' is-fail'}`}
          >
            <span className="settings-modal-test-tag">
              {compute.lastTest.ok ? 'OK' : 'FAIL'}
            </span>
            <span>{compute.lastTest.message}</span>
          </span>
        )}
      </div>

      {compute.lastTest?.ok && compute.lastTest.packages && (
        <div className="settings-modal-packages-line">
          Packages:{' '}
          {Object.entries(compute.lastTest.packages)
            .map(([key, value]) => `${key}=${value}`)
            .join(' · ') || '(none detected)'}
        </div>
      )}
    </Section>
  )
}
