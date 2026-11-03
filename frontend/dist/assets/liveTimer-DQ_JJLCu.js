function l(a,r){if(r<=0)return{stop:()=>{}};if(typeof window<"u"&&typeof Worker<"u"&&typeof Blob<"u")try{const e=`
        let timerId = null;
        self.onmessage = function(e) {
          if (e.data && e.data.action === 'start') {
            if (timerId) clearInterval(timerId);
            timerId = setInterval(function() {
              self.postMessage('tick');
            }, e.data.interval);
          } else if (e.data && e.data.action === 'stop') {
            if (timerId) {
              clearInterval(timerId);
              timerId = null;
            }
          }
        };
      `,n=new Blob([e],{type:"application/javascript"}),i=URL.createObjectURL(n),t=new Worker(i);return t.onmessage=c=>{if(c.data==="tick")try{a()}catch(s){console.error("[LiveTimer] Error in timer callback:",s)}},t.postMessage({action:"start",interval:r}),{stop:()=>{try{t.postMessage({action:"stop"}),t.terminate(),URL.revokeObjectURL(i)}catch{}}}}catch(e){console.warn("[LiveTimer] Web Worker initialization failed, falling back to setInterval:",e)}const o=setInterval(()=>{try{a()}catch(e){console.error("[LiveTimer] Error in fallback timer callback:",e)}},r);return{stop:()=>clearInterval(o)}}export{l as s};
