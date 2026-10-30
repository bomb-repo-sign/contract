// Local regression evidence only. Production source is compiled unchanged.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const { dependency } = require('./runtime.cjs');
process.env.HARDHAT_CONFIG ||= path.join(__dirname, 'hardhat.config.cjs');
const hre = dependency('hardhat');
const rows = [];
let productionInterface;
function ok(label, condition) { assert(condition, label); rows.push({ label, passed: true }); console.log('PASS ' + label); }
async function mined(promise) { return (await promise).wait(); }
async function rejected(label, action, expectedError) {
  let caught;
  try { await action(); } catch (error) { caught = error; }
  assert(caught, label + ': action unexpectedly succeeded');
  if (expectedError) {
    const data = [caught.data, caught.error?.data, caught.cause?.data, caught.info?.error?.data].find(value => typeof value === 'string');
    assert(data, label + ': missing EVM revert data');
    const parsed = productionInterface.parseError(data);
    assert(parsed && parsed.name === expectedError, label + ': expected ' + expectedError + ', got ' + parsed?.name);
  }
  rows.push({ label, passed: true, expectedRevert: true, ...(expectedError ? { expectedError } : {}) });
  console.log('PASS rejected ' + label);
}
const readArtifact = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'build', name + '.json')));
const pad = address => hre.ethers.zeroPadValue(address, 32);

async function main() {
  const E = hre.ethers;
  const chainId = (await E.provider.getNetwork()).chainId;
  ok('execution uses only in-process Hardhat', hre.network.name === 'hardhat');
  ok('local chain ID is requested test ID', chainId === BigInt(process.env.RWAI_TEST_CHAIN_ID || 56));
  console.log('LIMITS: local test signers and mock Endpoint; no real DVN, Executor, finality, Safe or live RPC verification.');
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'build/metadata.json')));
  ok('tested artifact source hash matches current production source', crypto.createHash('sha256').update(fs.readFileSync(meta.sourcePath)).digest('hex') === meta.sourceSha256);
  const artifact = readArtifact('RWAIOFT');
  productionInterface = new E.Interface(artifact.abi);
  const expectedArtifact = JSON.parse(fs.readFileSync(process.env.RWAI_EXPECTED_ARTIFACT || meta.expectedArtifactPath));
  const normalizedBytecode = code => code.replace(/^0x/, '');
  ok('tested creation bytecode equals authoritative compiled artifact', artifact.evm.bytecode.object === normalizedBytecode(expectedArtifact.bytecode || expectedArtifact.evm.bytecode.object));
  ok('tested runtime bytecode equals authoritative compiled artifact', artifact.evm.deployedBytecode.object === normalizedBytecode(expectedArtifact.deployedBytecode || expectedArtifact.evm.deployedBytecode.object));
  const names = artifact.abi.filter(item => item.type === 'function').map(item => item.name);
  ok('no public admin mint function in production ABI', !names.includes('mint'));
  ok('obsolete ownerMinted getter is absent', !names.includes('ownerMinted'));
  ok('obsolete direct Minted event is absent', !artifact.abi.some(item => item.type === 'event' && item.name === 'Minted'));
  ok('standard transfer, burn, permit and OFT bridge functions remain', ['transfer', 'transferBatch', 'burn', 'burnFrom', 'permit', 'send', 'quoteSend', 'quoteOFT', 'setPeer'].every(name => names.includes(name)));
  ok('no blacklist, pause or freeze was introduced', !names.some(name => /blacklist|pause|freeze/i.test(name)));
  const [deployer, admin, holder, next, stranger, delegate, recipient, spender] = await E.getSigners();
  async function deploy(name, args = [], signer = deployer) {
    const a = readArtifact(name);
    const c = await new E.ContractFactory(a.abi, '0x' + a.evm.bytecode.object, signer).deploy(...args);
    await c.waitForDeployment(); return c;
  }
  const ep = await deploy('ReviewEndpoint');
  const token = await deploy('RWAIOFT', [ep.target, admin.address]);
  const initial = chainId === 56n || chainId === 97n ? 10n ** 27n : 0n;
  const unit = 10n ** 18n, rate = 10n ** 12n;
  ok('genesis supply is 1B on local chain 56/97 and zero on chain 1', await token.totalSupply() === initial);
  ok('ADMIN receives exactly genesis supply', await token.balanceOf(admin.address) === initial);
  ok('deployer receives no genesis tokens', await token.balanceOf(deployer.address) === 0n);
  ok('ADMIN is initial owner', await token.owner() === admin.address);
  ok('ADMIN is initial Endpoint delegate', await ep.delegates(token.target) === admin.address);
  const mintData = E.id('mint(address,uint256)').slice(0, 10) + E.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [holder.address, unit]).slice(2);
  const beforeMint = await token.totalSupply();
  for (const [label, actor] of [['owner', admin], ['deployment signer', deployer], ['ordinary account', stranger]]) {
    await rejected(label + ' cannot invoke removed mint selector', () => actor.sendTransaction({ to: token.target, data: mintData }));
  }
  ok('removed mint calls leave supply and recipient balance unchanged', await token.totalSupply() === beforeMint && await token.balanceOf(holder.address) === 0n);
  await rejected('nonowner cannot register a new peer', () => token.connect(stranger).setPeer(30101, pad(stranger.address)), 'OwnableUnauthorizedAccount');
  await rejected('owner cannot register zero peer', () => token.connect(admin).setPeer(30101, E.ZeroHash), 'ZeroPeer');
  await mined(token.connect(admin).setPeer(30101, pad(deployer.address)));
  ok('owner can add a previously unused chain EID', await token.peers(30101) === pad(deployer.address));
  await rejected('owner cannot replace an existing peer', () => token.connect(admin).setPeer(30101, pad(stranger.address)), 'PeerLocked');
  await rejected('owner cannot delete an existing peer', () => token.connect(admin).setPeer(30101, E.ZeroHash), 'ZeroPeer');
  await rejected('nonowner cannot assign delegate', () => token.connect(stranger).setDelegate(stranger.address));
  await mined(token.connect(admin).setDelegate(delegate.address));
  ok('owner can assign a separate Endpoint delegate', await ep.delegates(token.target) === delegate.address);
  await rejected('delegate cannot directly invoke removed mint selector', () => delegate.sendTransaction({ to: token.target, data: mintData }));
  await rejected('delegate cannot add token peer', () => token.connect(delegate).setPeer(30103, pad(stranger.address)));
  await mined(ep.connect(delegate).setConfigMarker(token.target, 7));
  ok('assigned delegate retains mock Endpoint configuration authority', await ep.configMarker(token.target) === 7n);
  await rejected('nonowner cannot nominate successor', () => token.connect(stranger).transferOwnership(stranger.address));
  await mined(token.connect(admin).transferOwnership(next.address));
  ok('ownership handoff waits for nominated account acceptance', await token.owner() === admin.address && await token.pendingOwner() === next.address);
  await rejected('pending owner cannot add new peer', () => token.connect(next).setPeer(30103, pad(recipient.address)));
  await rejected('unrelated account cannot accept ownership', () => token.connect(stranger).acceptOwnership());
  await mined(token.connect(admin).setPeer(30104, pad(recipient.address)));
  ok('old owner retains peer administration until acceptance', await token.peers(30104) === pad(recipient.address));
  await mined(token.connect(next).acceptOwnership());
  ok('nominated successor becomes owner', await token.owner() === next.address && await token.pendingOwner() === E.ZeroAddress);
  ok('ownership acceptance synchronizes Endpoint delegate', await ep.delegates(token.target) === next.address);
  await rejected('former owner cannot add peer', () => token.connect(admin).setPeer(30105, pad(recipient.address)));
  await rejected('former delegate cannot configure mock Endpoint after handoff', () => ep.connect(delegate).setConfigMarker(token.target, 8));
  await rejected('new owner also cannot invoke removed mint selector', () => next.sendTransaction({ to: token.target, data: mintData }));
  await mined(token.connect(next).setPeer(30105, pad(recipient.address)));
  ok('new owner can add another previously unused EID', await token.peers(30105) === pad(recipient.address));
  await rejected('owner cannot install message inspector', () => token.connect(next).setMsgInspector(stranger.address));
  const encoded = E.solidityPacked(['bytes32', 'uint64'], [pad(holder.address), 1_000_000n]);
  await rejected('ordinary caller cannot fake Endpoint receive', () => token.connect(stranger).lzReceive([30101, pad(deployer.address), 1], E.ZeroHash, encoded, stranger.address, '0x'), 'OnlyEndpoint');
  await rejected('fixed mock Endpoint cannot credit wrong peer', () => ep.inject(token.target, 30101, pad(stranger.address), holder.address, 1_000_000n), 'OnlyPeer');
  await rejected('fixed mock Endpoint cannot credit unregistered EID', () => ep.inject(token.target, 30108, pad(deployer.address), holder.address, 1_000_000n), 'NoPeer');
  await rejected('ordinary caller cannot invoke simulation directly', () => token.lzReceiveSimulate([30101, pad(deployer.address), 1], E.ZeroHash, encoded, stranger.address, '0x'), 'OnlySelf');
  const beforeTrusted = await token.totalSupply();
  await mined(ep.inject(token.target, 30101, pad(deployer.address), holder.address, 100_000_000n));
  ok('registered peer message through fixed mock Endpoint still mints bridge credit', await token.balanceOf(holder.address) === 100n * unit && await token.totalSupply() === beforeTrusted + 100n * unit);
  await rejected('owner cannot seize holder balance without approval', () => token.connect(next).transferFrom(holder.address, next.address, unit));
  await rejected('nonowner cannot burn holder balance without approval', () => token.connect(stranger).burnFrom(holder.address, unit));
  await mined(token.connect(holder).transfer(recipient.address, unit));
  ok('ordinary ERC20 transfer remains functional', await token.balanceOf(recipient.address) === unit);
  await mined(token.connect(holder).approve(spender.address, 3n * unit));
  await mined(token.connect(spender).transferFrom(holder.address, recipient.address, unit));
  ok('approved transfer consumes allowance', await token.allowance(holder.address, spender.address) === 2n * unit);
  const beforeBurn = await token.totalSupply();
  await mined(token.connect(holder).burn(unit));
  await mined(token.connect(spender).burnFrom(holder.address, unit));
  ok('holder burn and approved burnFrom reduce supply correctly', await token.totalSupply() === beforeBurn - 2n * unit && await token.allowance(holder.address, spender.address) === unit);
  const batchBefore = await token.balanceOf(holder.address);
  await rejected('failed batch transfer is atomic', () => token.connect(holder).transferBatch([recipient.address, E.ZeroAddress], [unit, unit]));
  ok('failed batch preserves balance', await token.balanceOf(holder.address) === batchBefore);
  await mined(token.connect(holder).transferBatch([recipient.address, stranger.address], [unit, unit]));
  ok('valid batch transfers only holder balances', await token.balanceOf(holder.address) === batchBefore - 2n * unit);
  await rejected('ordinary transfer to token itself remains blocked', () => token.connect(holder).transfer(token.target, unit));
  const deadline = BigInt((await E.provider.getBlock('latest')).timestamp) + 3600n;
  const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
  const permitMessage = { owner: holder.address, spender: spender.address, value: 4n * unit, nonce: await token.nonces(holder.address), deadline };
  const domain = { name: 'RWAI', version: '1', chainId, verifyingContract: token.target };
  const forged = E.Signature.from(await stranger.signTypedData(domain, types, permitMessage));
  await rejected('forged permit fails', () => token.permit(holder.address, spender.address, 4n * unit, deadline, forged.v, forged.r, forged.s));
  const sig = E.Signature.from(await holder.signTypedData(domain, types, permitMessage));
  await mined(token.permit(holder.address, spender.address, 4n * unit, deadline, sig.v, sig.r, sig.s));
  ok('valid permit updates allowance and nonce', await token.allowance(holder.address, spender.address) === 4n * unit && await token.nonces(holder.address) === permitMessage.nonce + 1n);
  await rejected('permit signature cannot replay', () => token.permit(holder.address, spender.address, 4n * unit, deadline, sig.v, sig.r, sig.s));
  await mined(token.connect(next).transferOwnership(admin.address));
  await mined(token.connect(next).renounceOwnership());
  ok('renounce clears owner and pending owner', await token.owner() === E.ZeroAddress && await token.pendingOwner() === E.ZeroAddress);
  ok('renounce clears Endpoint delegate', await ep.delegates(token.target) === E.ZeroAddress);
  await rejected('former owner cannot add chain after renounce', () => token.connect(next).setPeer(30106, pad(recipient.address)));
  await rejected('renounce cancels pending ownership acceptance', () => token.connect(admin).acceptOwnership());
  await rejected('former owner cannot restore delegate after renounce', () => token.connect(next).setDelegate(next.address));
  await rejected('former owner cannot invoke removed mint after renounce', () => next.sendTransaction({ to: token.target, data: mintData }));
  ok('previous peer remains registered after renounce', await token.peers(30101) === pad(deployer.address));
  const balanceBeforeRenounced = await token.balanceOf(recipient.address);
  await mined(token.connect(holder).transfer(recipient.address, unit));
  ok('ordinary transfers continue after renounce', await token.balanceOf(recipient.address) === balanceBeforeRenounced + unit);
  const supplyBeforeRenounced = await token.totalSupply();
  await mined(ep.inject(token.target, 30101, pad(deployer.address), holder.address, 1_000_000n));
  ok('previously registered bridge receive continues after renounce', await token.totalSupply() === supplyBeforeRenounced + unit);

  // Both token instances run on one local chain ID; each constructor follows that ID.
  // Chain 1 needs explicit mock receive seed. Conservation is measured after seed,
  // never interpreted as proof of a unique global genesis or real DVN consensus.
  const a = await deploy('RWAIOFT', [ep.target, admin.address]);
  const b = await deploy('RWAIOFT', [ep.target, admin.address]);
  await mined(ep.setEid(a.target, 30102)); await mined(ep.setEid(b.target, 30101));
  await mined(a.connect(admin).setPeer(30101, pad(b.target)));
  await mined(b.connect(admin).setPeer(30102, pad(a.target)));
  if (initial > 0n) await mined(a.connect(admin).transfer(holder.address, 1000n * unit));
  else await mined(ep.inject(a.target, 30101, pad(b.target), holder.address, 1_000_000_000n));
  const combinedBaseline = await a.totalSupply() + await b.totalSupply();
  const params = (to, amount, minimum = amount, dst = 30101) => ({ dstEid: dst, to: pad(to), amountLD: amount, minAmountLD: minimum, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' });
  async function send(token, actor, p) {
    const result = await token.connect(actor).send.staticCall(p, { nativeFee: 0, lzTokenFee: 0 }, actor.address);
    await mined(token.connect(actor).send(p, { nativeFee: 0, lzTokenFee: 0 }, actor.address));
    return result[0].guid;
  }
  const baselineA = await a.totalSupply(), baselineB = await b.totalSupply();
  const balanceA = await a.balanceOf(holder.address);
  const p = params(holder.address, 25n * unit);
  await a.quoteOFT(p); await a.quoteSend(p, false);
  const guid = await send(a, holder, p);
  ok('send burns exact source amount before delivery', await a.totalSupply() === baselineA - 25n * unit && await a.balanceOf(holder.address) === balanceA - 25n * unit);
  ok('destination supply is unchanged while packet is in flight', await b.totalSupply() === baselineB);
  ok('source plus destination plus in-flight amount is conserved', await a.totalSupply() + await b.totalSupply() + 25n * unit === combinedBaseline);
  await mined(ep.deliver(guid));
  ok('delivery credits exact receiver amount', await b.balanceOf(holder.address) === 25n * unit);
  ok('completed bridge conserves combined local fixture supply', await a.totalSupply() + await b.totalSupply() === combinedBaseline);
  await rejected('mock transport rejects already delivered packet', () => ep.deliver(guid));
  const back = await send(b, holder, params(holder.address, 25n * unit, 25n * unit, 30102));
  await mined(ep.deliver(back));
  ok('round trip restores source holder balance and zero destination holder balance', await a.balanceOf(holder.address) === balanceA && await b.balanceOf(holder.address) === 0n);
  ok('round trip conserves combined fixture supply', await a.totalSupply() + await b.totalSupply() === combinedBaseline);
  const dustBefore = await a.balanceOf(holder.address);
  const dustGuid = await send(a, holder, params(holder.address, rate + 123n, rate));
  await mined(ep.deliver(dustGuid));
  ok('non-bridgeable dust remains at source', await a.balanceOf(holder.address) === dustBefore - rate && await b.balanceOf(holder.address) === rate);
  const beforeFailed = await a.totalSupply(), beforeFailedBalance = await a.balanceOf(holder.address);
  await mined(ep.setTransportFails(true));
  await rejected('transport failure reverts complete send', () => send(a, holder, params(holder.address, unit)));
  ok('failed send restores source supply and balance', await a.totalSupply() === beforeFailed && await a.balanceOf(holder.address) === beforeFailedBalance);
  await mined(ep.setTransportFails(false));
  const oversize = (((1n << 64n) - 1n) + 1n) * rate;
  await rejected('quoteOFT keeps v3 uint64 guard', () => a.quoteOFT(params(holder.address, oversize)), 'AmountTooLarge');
  await rejected('quoteSend keeps v3 uint64 guard', () => a.quoteSend(params(holder.address, oversize), false), 'AmountTooLarge');
  await rejected('send keeps v3 uint64 guard', () => send(a, holder, params(holder.address, oversize)), 'AmountTooLarge');
  ok('oversized attempts preserve supply and balance', await a.totalSupply() === beforeFailed && await a.balanceOf(holder.address) === beforeFailedBalance);
  await mined(a.connect(admin).renounceOwnership());
  await mined(b.connect(admin).renounceOwnership());
  const afterRenounceSum = await a.totalSupply() + await b.totalSupply();
  const afterRenounceGuid = await send(a, holder, params(holder.address, unit));
  await mined(ep.deliver(afterRenounceGuid));
  const afterRenounceBack = await send(b, holder, params(holder.address, unit, unit, 30102));
  await mined(ep.deliver(afterRenounceBack));
  ok('existing bidirectional bridge continues after both owners renounce', await a.totalSupply() + await b.totalSupply() === afterRenounceSum);

  // A malicious trusted remote, or a compromised/malicious fixed Endpoint, can
  // supply an authenticated-looking credit without a corresponding source burn.
  // Removing direct mint does not remove this bridge trust assumption.
  const beforeAttack = await a.totalSupply() + await b.totalSupply();
  await mined(ep.inject(a.target, 30101, pad(b.target), stranger.address, 2_000_000n));
  ok('residual risk: trusted mock message can inflate supply without source burn', await a.totalSupply() + await b.totalSupply() === beforeAttack + 2n * unit && await a.balanceOf(stranger.address) === 2n * unit);
  console.log('TOTAL ASSERTIONS ' + rows.length + ' ALL PASSED');
  const output = { chainId: chainId.toString(), sourceSha256: meta.sourceSha256, compiler: meta.compiler, provider: 'in-process Hardhat', assertions: rows.length, allPassed: true, limits: 'Local mock transport only; not real DVN, Executor, finality, Safe, or globally unique genesis validation. Both bridge fixtures are deployed on one local chain ID. Explicit mock seed is used on chain 1. Endpoint inject deliberately models trusted-message compromise.', residualRisk: 'Trusted peer / fixed Endpoint can create authenticated-looking credit without source burn; not fixed by removing direct mint.', rows };
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'local-' + chainId + '.json'), JSON.stringify(output, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
