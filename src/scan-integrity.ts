import type {Scan} from './school-client.ts';

// A transport-valid [] can still mean an unavailable or incorrect student session.
// Keep a known nonempty baseline until a genuinely empty state is verified separately.
export function requireSafeScanTransition(previous:Scan|undefined,next:Scan,minimumActivities=0):void {
  if(!next.complete)throw new Error('INCOMPLETE_SCAN_NOT_COMMITTED');
  if(next.activities.length===0&&(minimumActivities>0||(previous?.activities.length??0)>0))throw new Error('UNEXPECTED_EMPTY_SCAN_NOT_COMMITTED');
}
