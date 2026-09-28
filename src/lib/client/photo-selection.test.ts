import {describe,expect,it} from 'vitest';
import {selectPhoto,selectionModifiers} from './photo-selection';
const visible=[2,9,10,21,30];
describe('photo selection modifiers',()=>{
 it('plain click selects one, Ctrl/Cmd toggle without disturbing other selections',()=>{
  expect(selectPhoto([2,9],visible,2,10).selected).toEqual([10]);
  expect(selectPhoto([2,9],visible,2,10,{ctrlKey:true})).toEqual({selected:[2,9,10],anchor:10});
  expect(selectPhoto([2,9],visible,2,9,{metaKey:true})).toEqual({selected:[2],anchor:9});
 });
 it('shift ranges extend from a stable anchor without removing prior selections',()=>{
  const first=selectPhoto([9],visible,9,30,{shiftKey:true});expect(first).toEqual({selected:[9,10,21,30],anchor:9});
  expect(selectPhoto(first.selected,visible,first.anchor,10,{shiftKey:true})).toEqual({selected:[9,10,21,30],anchor:9});
  expect(selectPhoto([21],visible,21,2,{shiftKey:true}).selected).toEqual([21,2,9,10]);
  expect(selectPhoto([9],[30,21,10,9,2],9,30,{shiftKey:true}).selected).toEqual([9,30,21,10]);
 });
 it('selecting 1 and 2 then Shift-clicking 10 keeps all of 1 through 10',()=>{
  const list=Array.from({length:12},(_,i)=>i+1);
  for(const modifier of [{ctrlKey:true},{metaKey:true},{toggleOnly:true}]){
   const one=selectPhoto([],list,null,1);
   const two=selectPhoto(one.selected,list,one.anchor,2,modifier);
   expect(selectPhoto(two.selected,list,two.anchor,10,{shiftKey:true}).selected).toEqual(list.slice(0,10));
  }
 });
 it('Ctrl/Cmd+Shift adds a range while retaining deliberate outside selections',()=>{
  for(const key of ['ctrlKey','metaKey'])expect(selectPhoto([30,9],visible,9,21,{shiftKey:true,[key]:true}).selected).toEqual([30,9,10,21]);
 });
 it('never expands through hidden photos, and a missing anchor starts at the clicked photo',()=>{
  expect(selectPhoto([2,9,30],[2,10,21],2,21,{shiftKey:true}).selected).toEqual([2,9,30,10,21]);
  expect(selectPhoto([9],[2,10,21],9,21,{shiftKey:true})).toEqual({selected:[9,21],anchor:21});
  expect(selectPhoto([9],[2,10,21],9,21,{shiftKey:true,ctrlKey:true})).toEqual({selected:[9,21],anchor:21});
  expect(selectPhoto([],visible,null,21,{shiftKey:true})).toEqual({selected:[21],anchor:21});
  expect(selectPhoto([2],visible,2,999,{shiftKey:true})).toEqual({selected:[2],anchor:2});
 });
 it('touch, pen and keyboard activation retain toggle semantics',()=>{
  for(const event of [{pointerType:'touch',detail:1},{pointerType:'pen',detail:1},{detail:0}]){
   const mods=selectionModifiers(event as MouseEvent);expect(selectPhoto([2],visible,2,9,mods).selected).toEqual([2,9]);
   expect(selectPhoto([2,9],visible,9,9,mods).selected).toEqual([2]);
  }
 });
});
