import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {toast} from 'sonner';
import {ProgramEditorForm} from './ProgramEditorForm';
import {api} from '@/services/api';
beforeEach(()=>{URL.createObjectURL=vi.fn(()=> 'blob:program-test');URL.revokeObjectURL=vi.fn();});
function complete(){fireEvent.change(screen.getByLabelText('Nome do programa'),{target:{value:'Programa teste'}});fireEvent.change(screen.getByLabelText('Slug'),{target:{value:'programa-teste'}});}
describe('Program image and public presenter names',()=>{
 it('uploads an image before saving the program and includes public names',async()=>{
  vi.spyOn(api,'uploadProgramImage').mockResolvedValue({id:'asset-test',imageUrl:'https://media.example.test/program.webp'});const save=vi.fn().mockResolvedValue(undefined);
  render(<ProgramEditorForm initial={null} busy={false} save={save}/>);complete();
  fireEvent.change(screen.getByLabelText('Locutores/apresentadores (nomes públicos)'),{target:{value:' Locutor A, Locutora B '}});
  fireEvent.change(screen.getByLabelText('Imagem do programa'),{target:{files:[new File(['image'],'program.png',{type:'image/png'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar programa'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({presenters:['Locutor A','Locutora B'],imageAssetId:'asset-test'})));expect(api.uploadProgramImage).toHaveBeenCalledTimes(1);
 });
 it('does not claim the program was saved when R2 upload fails',async()=>{
  vi.spyOn(api,'uploadProgramImage').mockRejectedValue(new Error('R2 indisponível'));const error=vi.spyOn(toast,'error'),save=vi.fn();
  render(<ProgramEditorForm initial={null} busy={false} save={save}/>);complete();fireEvent.change(screen.getByLabelText('Imagem do programa'),{target:{files:[new File(['image'],'program.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'Salvar programa'}));await waitFor(()=>expect(error).toHaveBeenCalledWith('R2 indisponível'));expect(save).not.toHaveBeenCalled();
 });
 it('can remove the image without deleting its media record',async()=>{
  const save=vi.fn().mockResolvedValue(undefined);render(<ProgramEditorForm initial={{id:'program',name:'Programa teste',slug:'programa-teste',description:'',active:true,version:2,presenters:['A'],imageAssetId:'old-asset',imageUrl:'https://media.example.test/old.webp'}} busy={false} save={save}/>);
  fireEvent.click(screen.getByRole('button',{name:'Remover imagem do programa'}));fireEvent.click(screen.getByRole('button',{name:'Salvar programa'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({imageAssetId:null,version:2})));
 });
});
