const path = require('path');
const fs = require('fs');
const localDependencies = path.join(__dirname, 'node_modules');
const dependencies = path.resolve(process.env.RWAI_TEST_NODE_MODULES || (fs.existsSync(localDependencies) ? localDependencies : path.join(__dirname, '../../node_modules')));
if (!fs.existsSync(dependencies)) throw new Error('Set RWAI_TEST_NODE_MODULES to the reviewed dependency installation.');
module.exports = { dependencies, dependency: name => require(path.join(dependencies, name)) };
