import {describe,it,expect} from 'vitest';
import {participationFilters,participationModeration} from '../../src/schemas/participation.js';
describe('participation admin contract',()=>{
 it.each(['reviewed','selected','rejected'])('accepts moderation to %s',state=>{
 expect(participationModeration.parse({version:1,state})).toEqual({version:1,state});
 });
 it('rejects received and any content edits',()=>{
 for(const body of [{version:1,state:'received'},{version:1,state:'reviewed',message:'Changed'},{version:1,state:'reviewed',displayName:'Changed'},{version:0,state:'selected'},{version:1.2,state:'selected'},{version:1,state:'selected',note:'a'.repeat(501)}])expect(participationModeration.safeParse(body).success).toBe(false);
 expect(participationModeration.safeParse({version:1,state:'reviewed',note:'a'.repeat(500)}).success).toBe(true);
 });
 it('validates only known filters without treating poll permission as access',()=>{
 expect(participationFilters.parse({state:'received'})).toEqual({state:'received'});
 for(const query of [{state:'published'},{pollId:'bad'},{after:'bad'},{count:true}])expect(participationFilters.safeParse(query).success).toBe(false);
 });
});
