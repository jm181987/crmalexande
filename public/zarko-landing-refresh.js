/* Progressive landing enhancements; no effect on CRM dashboard. */
(()=>{'use strict';
const init=()=>{
 const nav=()=>document.body.classList.toggle('zarko-scrolled',window.scrollY>24);
 nav();window.addEventListener('scroll',nav,{passive:true});
 if(!('IntersectionObserver'in window)||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const targets=document.querySelectorAll('#topo h1,#topo p,#problema h2,#ecossistema h2,#comparativo h2,#setores h2,#faq h2,#contato h2,#problema .grid > *,#ecossistema .grid > *,#setores .grid > *');
 const observer=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting){e.target.classList.add('zarko-visible');observer.unobserve(e.target)}}},{threshold:.08,rootMargin:'0px 0px -30px 0px'});
 targets.forEach(el=>{el.classList.add('zarko-reveal');observer.observe(el)});
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
