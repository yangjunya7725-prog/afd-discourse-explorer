(()=>{
  const realFetch=window.fetch.bind(window);
  let corpusPromise=null;
  const CHUNK=18000;
  async function corpus(){
    if(!corpusPromise){
      corpusPromise=realFetch('data/corpus.json.gz.b64').then(r=>{
        if(!r.ok) throw new Error('Failed to load corpus');
        return r.text();
      });
    }
    return corpusPromise;
  }
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const m=url.match(/data\/corpus\.part(\d{2})(?:$|[?#])/);
    if(!m) return realFetch(input,init);
    const text=(await corpus()).trim();
    const i=Number(m[1]);
    const part=text.slice(i*CHUNK,(i+1)*CHUNK);
    return new Response(part,{status:200,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  };
})();
