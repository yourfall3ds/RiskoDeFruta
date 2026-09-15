import {SKILL_CUES,SkillTimeline} from '../combat/SkillTimeline';
export class SkillCutIn {
 readonly element=document.createElement('div');
 constructor(){this.element.className='skill-cut-in';this.element.hidden=true;this.element.innerHTML='<div class="cinema-top"></div><div class="cinema-caption"><small>EXTERMINADOR AGRÍCOLA</small><strong></strong></div><div class="cinema-bottom"></div>';document.body.append(this.element);}
 update(timeline:SkillTimeline,visible:boolean):void{this.element.hidden=!timeline.closeVisible||!visible;document.body.classList.toggle('skill-cinematic',timeline.closeVisible&&visible);this.element.querySelector('strong')!.textContent=SKILL_CUES[timeline.tier].name;this.element.style.opacity=String(timeline.preparing?Math.min(1,timeline.elapsed/.1):Math.max(0,1-(timeline.elapsed-SKILL_CUES[timeline.tier].release)/.22));}
 dispose():void{document.body.classList.remove('skill-cinematic');this.element.remove();}
}
