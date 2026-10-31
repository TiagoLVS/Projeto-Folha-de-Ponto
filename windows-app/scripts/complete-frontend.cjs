// Completa dependências de inicialização que o tracing do Next não inclui em alguns builds.
const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../frontend');const destination=path.resolve(__dirname,'../staging/frontend/node_modules');
const versions=new Map();
function locate(name,from){
 const require=createRequire(path.join(from,'package.json'));let entry;
 try{entry=require.resolve(name+'/package.json');}catch{entry=require.resolve(name);}
 let current=path.dirname(entry);
 while(true){const file=path.join(current,'package.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).name===name)return current;const parent=path.dirname(current);if(parent===current)throw new Error('Dependência não encontrada: '+name);current=parent;}
}
function copy(name,from){
 const source=locate(name,from);const metadata=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
 if(versions.has(name)){if(versions.get(name)!==metadata.version)throw new Error('Dependência com versões incompatíveis: '+name);return;}
 versions.set(name,metadata.version);
 fs.cpSync(source,path.join(destination,...name.split('/')),{recursive:true,dereference:true,filter:file=>!file.split(path.sep).slice(source.split(path.sep).length).includes('node_modules')});
 for(const dependency of Object.keys(metadata.dependencies||{}))copy(dependency,source);
}
for(const name of ['next','react','react-dom'])copy(name,root);
console.log('Dependências do servidor standalone conferidas:',versions.size);
