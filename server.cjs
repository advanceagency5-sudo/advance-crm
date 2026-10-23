const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.json':'application/json; charset=utf-8'};
function handler(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400).end();return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  const relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative)||(!['index.html'].includes(relative)&&!relative.startsWith('src'+path.sep)&&!relative.startsWith('assets'+path.sep))){res.writeHead(404).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data)});
}
function createServer(){return http.createServer(handler)}
if(require.main===module){const port=Number(process.env.PORT||4173),host=process.env.CRM_HOST||'127.0.0.1';createServer().listen(port,host,()=>console.log('AdVance CRM: http://'+host+':'+port));}
module.exports={createServer};
