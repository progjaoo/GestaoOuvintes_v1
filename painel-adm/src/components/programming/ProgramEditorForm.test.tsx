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

describe('Explicit program image picker',()=>{
 it('opens the native picker directly from a user click without submitting',()=>{
  const save=vi.fn();render(<ProgramEditorForm initial={null} busy={false} save={save}/>);
  const input=screen.getByLabelText('Imagem do programa') as HTMLInputElement;
  const showPicker=vi.fn();Object.defineProperty(input,'showPicker',{value:showPicker,configurable:true});
  fireEvent.click(screen.getByRole('button',{name:'Escolher imagem'}));
  expect(showPicker).toHaveBeenCalledTimes(1);expect(save).not.toHaveBeenCalled();
 });
 it('falls back to input click where showPicker is unavailable',()=>{
  render(<ProgramEditorForm initial={null} busy={false} save={vi.fn()}/>);
  const input=screen.getByLabelText('Imagem do programa') as HTMLInputElement;
  Object.defineProperty(input,'showPicker',{value:undefined,configurable:true});const click=vi.spyOn(input,'click');
  fireEvent.click(screen.getByRole('button',{name:'Escolher imagem'}));expect(click).toHaveBeenCalledTimes(1);
 });
 it('accepts a Finder drag/drop and displays its filename and preview',()=>{
  render(<ProgramEditorForm initial={null} busy={false} save={vi.fn()}/>);
  fireEvent.drop(screen.getByRole('group',{name:'Selecionar ou arrastar imagem do programa'}),{dataTransfer:{files:[new File(['image'],'capa.png',{type:'image/png'})]}});
  expect(screen.getByText('capa.png')).toBeInTheDocument();expect(screen.getByAltText('Prévia da imagem do programa')).toHaveAttribute('src','blob:program-test');
 });
 it('reports a blocked native dialog without a JavaScript alert',()=>{
  const error=vi.spyOn(toast,'error');render(<ProgramEditorForm initial={null} busy={false} save={vi.fn()}/>);
  Object.defineProperty(screen.getByLabelText('Imagem do programa'),'showPicker',{value:()=>{throw new DOMException('blocked','NotAllowedError');},configurable:true});
  fireEvent.click(screen.getByRole('button',{name:'Escolher imagem'}));expect(error).toHaveBeenCalledWith(expect.stringContaining('Arraste a imagem'));
 });
});
