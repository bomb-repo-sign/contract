'use strict';
const path=require('path'),fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../..');
const compiler=path.resolve(process.argv[2] || process.env.RWAI_TEST_SOLJSON || '');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(compiler)).digest('hex'),'92d283c545395b91a656fa1ec94d567a464bca55aebcdbb99debf42b43026845','Wrong compiler file');
const env={...process.env};
for(const name of ['PRIVATE_KEY','MNEMONIC','HARDHAT_CONFIG','NODE_OPTIONS','NODE_PATH']) delete env[name];
Object.assign(env,{
  RWAI_TEST_NODE_MODULES:path.resolve(process.env.RWAI_TEST_NODE_MODULES || path.join(root,'node_modules')),
  RWAI_TEST_SOLJSON:compiler,
  RWAI_SOURCE_ROOT:path.resolve(process.env.RWAI_SOURCE_ROOT || root),
  RWAI_STANDARD_INPUT:path.join(root,'verify/RWAIOFT.input.json'),
  RWAI_EXPECTED_ARTIFACT:path.join(root,'audit/build/RWAIOFT.json'),
  HARDHAT_CONFIG:path.join(root,'audit/tests/hardhat.config.cjs')
});
function run(script,extra={}){
 const result=spawnSync(process.execPath,[path.join(root,'audit/tests',script)],{cwd:root,env:{...env,...extra},stdio:'inherit'});
 if(result.error) throw result.error;
 if(result.status!==0) process.exit(result.status || 1);
}
run('compile.cjs');
for(const id of [56,97,1])run('test.cjs',{RWAI_TEST_CHAIN_ID:String(id)});
