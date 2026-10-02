import { describe, expect, it } from 'vitest';
import { projectLaunch } from './project-launch';
const base = { total: 4, visible: 3, published: true, expiresAt: null, scopedOnly: false, usableInvitations: 0 };
describe('project launch guidance', () => {
  it('does not call an empty draft ready', () => {
    const r=projectLaunch({...base,total:0,visible:0,published:false});
    expect(r.ready).toBe(false); expect(r.steps.filter(s=>!s.done).map(s=>s.key)).toEqual(['upload','prepare','publish']);
  });
  it('keeps intake-only or unfinished previews out of readiness', () => expect(projectLaunch({...base,visible:0}).ready).toBe(false));
  it('does not infer private delivery from publication alone', () => expect(projectLaunch({...base,scopedOnly:true}).steps[3].done).toBe(false));
  it('requires a usable invitation for scoped-only delivery', () => expect(projectLaunch({...base,scopedOnly:true,usableInvitations:1}).ready).toBe(true));
  it('treats the exact closing time as closed', () => expect(projectLaunch({...base,expiresAt:'2026-10-02T12:00:00Z'},Date.parse('2026-10-02T12:00:00Z')).steps[2].done).toBe(false));
  it('accepts intentionally partial delivery without claiming every photo is ready', () => { const r=projectLaunch(base); expect(r.ready).toBe(true);expect(r.steps[1].detail).toContain('3 photos'); });
});
