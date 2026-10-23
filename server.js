// FindingStore demo server. No dependencies. Providers: SerpAPI (real) or mock.
const http=require('http'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||8080, KEY=process.env.SERPAPI_KEY;
const COUNTRIES={PK:['Pakistan','PKR',280],IN:['India','INR',83],US:['United States','USD',1],GB:['United Kingdom','GBP',0.79],AE:['UAE','AED',3.67],SA:['Saudi Arabia','SAR',3.75],DE:['Germany','EUR',0.92],CA:['Canada','CAD',1.36],AU:['Australia','AUD',1.52],BD:['Bangladesh','BDT',110]};
const LOCAL={PK:['Daraz.pk','PriceOye','Telemart'],IN:['Amazon.in','Flipkart','Croma'],US:['Amazon.com','Walmart','Best Buy'],GB:['Amazon.co.uk','Argos','Currys'],AE:['Amazon.ae','Noon','Sharaf DG'],SA:['Amazon.sa','Noon','Extra'],DE:['Amazon.de','MediaMarkt','Otto'],CA:['Amazon.ca','Best Buy CA','Walmart CA'],AU:['Amazon.com.au','JB Hi-Fi','Kogan'],BD:['Daraz.com.bd','Pickaboo','Star Tech']};
const CACHE=(()=>{try{return JSON.parse(require('fs').readFileSync(__dirname+'/cache.json'))}catch{return {}}})();const json=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
async function geo(req){const ip=(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']||'').split(',')[0].trim();
  if(!ip) return null; try{const r=await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`,{signal:AbortSignal.timeout(3000)});const j=await r.json();return j.countryCode||null}catch{return null}}
// ---- Mock provider: clearly labelled example data ----
function mock(cc){const [name,cur,rate]=COUNTRIES[cc]||COUNTRIES.US;const base=49.99;const q=encodeURIComponent('Example Wireless Earbuds');
  const local=(LOCAL[cc]||LOCAL.US).map((s,i)=>({store:s,price:Math.round(base*rate*(1+0.12*i)),currency:cur,link:`https://www.google.com/search?q=${q}+${encodeURIComponent(s)}`}));
  const intl=[['AliExpress',0.62],['Amazon.com',1],['eBay',0.85],['Temu',0.7]].map(([s,f])=>({store:s,price:+(base*f).toFixed(2),currency:'USD',link:`https://www.google.com/search?q=${q}+${s}`}));
  return {mode:'mock',product:'Example Wireless Earbuds (sample — not identified from your photo)',local,intl};}
// ---- SerpAPI provider: Google Lens identify + Google Shopping prices ----
const STOP=new Set('the and for with from new set pcs size inch inches cm small medium large xl xxl all seasons season cute soft warm comfy cozy cozi best sale free shipping buy online price pakistan dogs cats dog cat pet pets for indoor washable removable non slip anti round'.split(' '));
const toks=t=>(t||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>2&&!/^\d+$/.test(w)).map(w=>w.length>3&&w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w);
const RAW=path.join(__dirname,'rawcache');fs.mkdirSync(RAW,{recursive:true});
const sjson=async q=>{const f=path.join(RAW,require('crypto').createHash('sha1').update(JSON.stringify(q)).digest('hex')+'.json');
  if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f));const j=await (await fetch('https://serpapi.com/search.json?'+new URLSearchParams({...q,api_key:KEY}))).json();
  if(!j.error)fs.writeFileSync(f,JSON.stringify(j));return j};
function ogImage(rows){return Promise.all(rows.filter(r=>!r.image).map(async r=>{try{const h=await (await fetch(r.link,{signal:AbortSignal.timeout(5000),headers:{'user-agent':'Mozilla/5.0'}})).text();
  const m=h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)||h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);if(m)r.image=new URL(m[1],r.link).href;}catch{}}))}
async function serp(imgUrl,cc){const lc=cc.toLowerCase();
  // 1) Lens: visually similar matches, once for the user's country and once for US (international)
  const [lensL,lensI]=await Promise.all([sjson({engine:'google_lens',url:imgUrl,country:lc,hl:'en'}),lc==='us'?null:sjson({engine:'google_lens',url:imgUrl,country:'us',hl:'en'})]);
  const LI=lensI||lensL;if(lensL.error&&LI.error) throw new Error('Google Lens: '+lensL.error);
  const vm=[...(lensL.visual_matches||[]),...(LI.visual_matches||[])];
  if(!vm.length) throw new Error('Could not identify the product from this image.');
  // 2) Descriptive keywords: words common across the top visual-match titles, brand/seller tokens removed
  const df={};
  vm.slice(0,40).forEach(m=>new Set(toks(m.title)).forEach(w=>{df[w]=(df[w]||0)+1}));
  const kw=Object.entries(df).filter(([w,n])=>n>=3&&!/^[bcdfghjklmnpqrstvwxz]{4,}$/.test(w)).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  const core=kw.filter(w=>!STOP.has(w)).slice(0,6);const query=[...core,...kw.filter(w=>STOP.has(w)&&/^(dog|cat|pet)s?$/.test(w)).slice(0,1),'bed'].filter((w,i,a)=>a.indexOf(w)===i&&(w!=='bed'||df.bed)).join(' ');
  const tot=core.reduce((a,w)=>a+df[w],0);const score=t=>{const T=new Set(toks(t));return tot?core.filter(w=>T.has(w)).reduce((a,w)=>a+df[w],0)/tot:0};
  const lensRows=vm.filter(m=>m.price?.extracted_value).map(m=>({store:m.source,price:m.price.extracted_value,currency:m.price.currency||'',link:m.link,image:m.thumbnail||null,title:m.title,src:'lens',score:score(m.title)>=0.5?0.6+score(m.title)/10:score(m.title)}));
  const host=r=>{try{return new URL(r.link).hostname}catch{return ''}};
  const isLocal=r=>host(r).endsWith('.'+lc)||host(r).includes('.'+lc+'.');
  // 3) Price search with the descriptive query
  const SHOP_OK=new Set(['us','gb','in','ae','sa','de','ca','au']);
  const shop=async gl=>{if(SHOP_OK.has(gl)){const j=await sjson({engine:'google_shopping',q:query,gl,hl:'en'});
      if(!j.error) return (j.shopping_results||[]).filter(r=>r.extracted_price).map(r=>({store:r.source,price:r.extracted_price,currency:(r.price||'').replace(/[\d.,\s]/g,'')||'',link:r.product_link||r.link,image:r.thumbnail||r.serpapi_thumbnail||null,title:r.title,src:'shopping',score:score(r.title)}));}
    const cname=(COUNTRIES[gl.toUpperCase()]||[gl])[0];const j=await sjson({engine:'google',q:query+' price in '+cname,gl,hl:'en',num:20});
    if(j.error) throw new Error('Google search: '+j.error);const cur=(COUNTRIES[gl.toUpperCase()]||[])[1]||'';
    return (j.organic_results||[]).map(r=>{const rich=r.rich_snippet?.top?.detected_extensions;let price=rich?.price;
      if(!price){const m=(r.snippet||'').match(/(?:Rs\.?|PKR|₨)\s?([\d,]{3,}(?:\.\d+)?)/i);if(m)price=parseFloat(m[1].replace(/,/g,''));}
      if(price&&price<500&&cur==='PKR')price=null; // implausible PKR price (usually a parse artefact)
      return price?{store:r.source||host(r),price,currency:cur||rich?.currency||'',link:r.link,image:r.thumbnail||null,title:r.title,src:'search',score:score(r.title+' '+(r.snippet||'')),note:'from search results, verify on store'}:null}).filter(Boolean);};
  const lensIntl=lensRows.filter(r=>!isLocal(r)).length;
  const [sl,si]=await Promise.all([shop(lc),lc==='us'||lensIntl>=5?Promise.resolve([]):shop('us')]);
  const split=rows=>{const seen=new Set();rows=rows.filter(r=>{const k=(r.link||'').split('?')[0];if(seen.has(k))return false;seen.add(k);return true});
    const good=rows.filter(r=>r.score>=0.6).sort((a,b)=>a.price-b.price).slice(0,10);const sim=rows.filter(r=>r.score<0.6).sort((a,b)=>b.score-a.score||a.price-b.price).slice(0,6);return [good,sim]};
  const localRows=[...lensRows.filter(isLocal),...sl],intlRows=[...lensRows.filter(r=>!isLocal(r)),...(lc==='us'?sl:si)];
  const [local,localSimilar]=split(localRows),[intl,intlSimilar]=split(intlRows);
  await ogImage([...local,...localSimilar]);
  return {mode:'live',product:query,lensTitle:vm[0]?.title,keywords:core,local,localSimilar,intl,intlSimilar};}
const server=http.createServer(async(req,res)=>{
  if(req.url==='/healthz'){res.writeHead(200,{'content-type':'text/plain'});return res.end('ok')}
  if((req.headers.host||'').toLowerCase().startsWith('findingstore.onrender.com')&&!req.url.startsWith('/api/')){res.writeHead(301,{location:'https://freefinding.store'+req.url});return res.end()}
  if(req.url==='/api/geo'){const cc=await geo(req);return json(res,200,{country:cc,countries:COUNTRIES,live:!!KEY})}
  if(req.url==='/api/search'&&req.method==='POST'){let b='';req.on('data',d=>{b+=d;if(b.length>12e6)req.destroy()});req.on('end',async()=>{
    try{const {image,imageUrl,country}=JSON.parse(b);const cc=COUNTRIES[country]?country:'US';
      if(!KEY) return json(res,200,mock(cc));
      if(imageUrl){const k=imageUrl+'|'+cc;if(!CACHE[k])CACHE[k]=await serp(imageUrl,cc);return json(res,200,CACHE[k]);}
      const buf=Buffer.from(image.split(',')[1],'base64');const h=require('crypto').createHash('sha1').update(buf).digest('hex')+'|'+cc;
      if(CACHE[h]) return json(res,200,CACHE[h]);
      const fd=new FormData();fd.append('reqtype','fileupload');fd.append('time','72h');fd.append('fileToUpload',new Blob([buf],{type:'image/jpeg'}),'upload.jpg');
      const pub=(await (await fetch('https://litterbox.catbox.moe/resources/internals/api.php',{method:'POST',body:fd})).text()).trim();
      if(!pub.startsWith('https://')) throw new Error('Temporary image host failed: '+pub.slice(0,100));
      console.log('uploaded',pub);CACHE[h]=await serp(pub,cc);CACHE[h].imageUrl=pub;CACHE[pub+'|'+cc]=CACHE[h];return json(res,200,CACHE[h]);
json(res,200,await serp(`${process.env.PUBLIC_URL}/uploads/${id}`,cc));}catch(e){json(res,500,{error:String(e)})}});return}
  let f=decodeURIComponent(req.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';
  let p=f.startsWith('/uploads/')?path.join(__dirname,f):path.join(__dirname,'public',f);
  if(!path.extname(p)&&fs.existsSync(p+'.html'))p+='.html';
  if(fs.existsSync(p)&&fs.statSync(p).isDirectory()&&!f.startsWith('/uploads/')){res.writeHead(301,{location:f+'/'});return res.end()}
  if(!(p.startsWith(path.join(__dirname,'public')+path.sep)||p.startsWith(path.join(__dirname,'uploads')+path.sep))||!fs.existsSync(p)||fs.statSync(p).isDirectory()){const nf=path.join(__dirname,'public','404.html');res.writeHead(404,{'content-type':'text/html; charset=utf-8'});return res.end(fs.existsSync(nf)?fs.readFileSync(nf):'Not found')}
  res.writeHead(200,{'content-type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'}[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);});
fs.mkdirSync(path.join(__dirname,'uploads'),{recursive:true});server.listen(PORT,()=>console.log('FindingStore on',PORT,KEY?'LIVE':'MOCK'));
