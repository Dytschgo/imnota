// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NATIVE_FAULT_CASE_SETS, nativeFaultCases, nativeFaultErrno } from '../src/shared/native-faults.js';
import { assertCaseInjections } from './native-fault-smoke.js';
// @ts-expect-error The launcher's catalog is plain Node JavaScript without a TypeScript surface.
import * as launcher from '../scripts/native-fault-catalog.mjs';

vi.mock('electron', () => ({ nativeImage: {} }));

const catalog = launcher as {
  faultCaseSets: readonly string[];
  faultCases(set: string): string[];
  faultCaseErrno(set: string, caseId: string): string | undefined;
};

describe('native fault catalog shared by the app and its launcher', () => {
  it('keeps identical sets, case IDs and per-case errnos', () => {
    expect([...catalog.faultCaseSets]).toEqual([...NATIVE_FAULT_CASE_SETS]);
    for (const set of NATIVE_FAULT_CASE_SETS) {
      expect(catalog.faultCases(set)).toEqual(nativeFaultCases(set));
      for (const caseId of nativeFaultCases(set))
        expect(catalog.faultCaseErrno(set, caseId) ?? 'EIO').toBe(nativeFaultErrno(set, caseId));
    }
    expect(NATIVE_FAULT_CASE_SETS.flatMap((set) => nativeFaultCases(set))).toHaveLength(35);
  });
  it('combines each errno family into one launch with every errno x scenario case distinct', () => {
    expect(nativeFaultCases('restore-errno')).toEqual([
      'screenshot-eio',
      'drawing-eio',
      'text-eio',
      'screenshot-eacces',
      'drawing-eacces',
      'text-eacces',
      'screenshot-eperm',
      'drawing-eperm',
      'text-eperm',
    ]);
    expect(nativeFaultCases('recovery-lineage-errno')).toEqual([
      'healthy-eio',
      'foreign-eio',
      'healthy-eacces',
      'foreign-eacces',
      'healthy-eperm',
      'foreign-eperm',
    ]);
    expect(nativeFaultErrno('restore-errno', 'drawing-eacces')).toBe('EACCES');
    expect(nativeFaultErrno('recovery-lineage-errno', 'foreign-eperm')).toBe('EPERM');
    expect(nativeFaultErrno('recovery-repair', 'failed-repair')).toBe('EIO');
    expect(() => nativeFaultErrno('restore-errno', 'screenshot')).toThrow('Unknown');
    expect(() => nativeFaultErrno('restore-errno', 'screenshot-enoent')).toThrow('Unknown');
  });
});

describe('per-case injection evidence inside a combined launch', () => {
  const injected = (caseId: string, errno: string) => ({ event: 'injected', caseId, errno });
  it('accepts only injections from the running case with its own errno', () => {
    expect(() =>
      assertCaseInjections('restore-errno', 'text-eperm', [injected('text-eperm', 'EPERM')]),
    ).not.toThrow();
    expect(() =>
      assertCaseInjections('restore-errno', 'text-eperm', [injected('text-eperm', 'EIO')]),
    ).toThrow('did not inject only EPERM');
    expect(() =>
      assertCaseInjections('restore-errno', 'text-eperm', [
        injected('text-eperm', 'EPERM'),
        injected('text-eacces', 'EACCES'),
      ]),
    ).toThrow('another case');
    expect(() => assertCaseInjections('recovery-lineage-errno', 'healthy-eio', [])).toThrow(
      'did not inject only EIO',
    );
  });
  it('keeps fixed-errno scenarios free to mix their designed codes', () => {
    expect(() =>
      assertCaseInjections('recovery-repair', 'failed-repair', [
        injected('failed-repair', 'EIO'),
        injected('failed-repair', 'EACCES'),
      ]),
    ).not.toThrow();
    expect(() =>
      assertCaseInjections('recovery-repair', 'failed-repair', [injected('baseline-repair', 'EIO')]),
    ).toThrow('another case');
  });
});
