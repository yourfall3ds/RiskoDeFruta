import {it,expect,vi} from 'vitest';
import {ItemPickupNotice} from '../src/ui/ItemPickupNotice';
import {installCountingDom,uninstallCountingDom} from './support/counting-dom';

it('shows icon, name and effect for four seconds per pickup, then clears on restart/dispose',()=>{
 vi.useFakeTimers();const dom=installCountingDom();
 const notice=new ItemPickupNotice(document.body);
 try{
  notice.show('feather');notice.show('pruner');
  const panel=dom.querySelector('.item-pickup-notice')!;
  expect(panel.hidden).toBe(false);
  expect(panel.textContent).toContain('Pena orbital');
  expect(panel.textContent).toContain('+1 pulo aéreo');
  expect(dom.querySelector('.item-pickup-icon')!.getAttribute('style')).toContain('04_feather.png');
  vi.advanceTimersByTime(3999);expect(panel.textContent).toContain('Pena orbital');
  vi.advanceTimersByTime(1);expect(panel.textContent).toContain('Podador de aço');
  vi.advanceTimersByTime(4000);expect(panel.hidden).toBe(true);
  notice.show('feather');notice.show('pruner');notice.clear();
  vi.advanceTimersByTime(8000);expect(panel.hidden).toBe(true);
  notice.show('pruner');notice.dispose();expect(vi.getTimerCount()).toBe(0);
 }finally{notice.dispose();uninstallCountingDom();vi.useRealTimers();}
});
