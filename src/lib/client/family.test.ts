import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {loadFamily,saveFamily,newPhotoCount} from './family';
let entries:Map<string,string>;
beforeEach(()=>{entries=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>entries.set(k,v)});});
afterEach(()=>vi.unstubAllGlobals());
describe('device-local family collections',()=>{
 it('merges visits and pins, isolates projects and identifies actual new arrivals',()=>{
  saveFamily(1,s=>s.pins=['child-a']);saveFamily(1,s=>s.seen['child-a']=[1,2]);saveFamily(1,s=>s.positions['/g/event/c/child-a']={y:500,photoId:2});
  const state=loadFamily(1);expect(state.pins).toEqual(['child-a']);expect(state.positions['/g/event/c/child-a'].photoId).toBe(2);expect(loadFamily(2).pins).toEqual([]);
  expect(newPhotoCount(state,'child-a',[2,3])).toBe(1);expect(newPhotoCount(state,'never-visited',[1,2,3])).toBe(0);
 });
 it('survives malformed storage but reports a refused write without pretending to save',()=>{
  entries.set('pk_family_1','not-json');expect(loadFamily(1).pins).toEqual([]);
  entries.set('pk_family_1',JSON.stringify({version:1,pins:['ok','<script>',null],seen:{ok:[1,-3,'2',null]},positions:{'/g/ok':{y:50,photoId:1},'/g/bad':{y:20,photoId:'bad] selector'},'https://bad':{y:60}}}));
  expect(loadFamily(1)).toEqual({pins:['ok'],seen:{ok:[1]},positions:{'/g/ok':{y:50,photoId:1},'/g/bad':{y:20,photoId:null}}});
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw Error('full');}});expect(()=>saveFamily(1,s=>s.pins=['a'])).toThrow('full');expect(loadFamily(1).pins).toEqual([]);
 });
});
