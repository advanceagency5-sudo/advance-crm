const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const interfaces=Object.entries(os.networkInterfaces()).flatMap(([name,items])=>items.filter(item=>item.family==='IPv4'&&!item.internal).map(item=>({name,address:item.address})));
const host=process.env.CRM_HOST||interfaces.find(item=>/wi-?fi/i.test(item.name))?.address;
if(!host)throw Error('Set CRM_HOST to the local Wi-Fi address.');
const port=Number(process.env.PORT||4174);
const file=path.join(__dirname,'../AdVance-CRM-Mobile-Demo.html');
http.createServer((req,res)=>{
 if(req.url!=='/'&&req.url!=='/index.html'){res.writeHead(404).end();return}
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
 fs.readFile(file,(error,body)=>{if(error){res.writeHead(503).end('Build mobile demo first.');return}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body)});
}).listen(port,host,()=>console.log('Mobile demo on your Wi-Fi: http://'+host+':'+port));
