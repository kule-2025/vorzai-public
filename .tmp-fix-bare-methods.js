const fs = require('fs');
let c = fs.readFileSync('server/tests/workflow-engine.test.ts', 'utf8');

const methods = [
  'createDefinition', 'updateDefinition', 'listDefinitions', 'getDefinition',
  'createNode', 'deleteNode', 'updateNode', 'getNode', 'getNodes',
  'createEdge', 'deleteEdge', 'getEdges',
  'deleteDefinition',
  'getWorkflowGraph', 'validateGraph', 'execute',
  'getRun', 'listRuns', 'getRunStatus', 'cancelRun'
];

for (const m of methods) {
  // Match lines that start with optional whitespace + method name + '('
  // Only replace if NOT already prefixed with workflowOrchestrator
  const re = new RegExp('^(\\s*)' + m + '\\(', 'gm');
  c = c.replace(re, function(match, indent) {
    return indent + 'workflowOrchestrator.' + m + '(';
  });
}

fs.writeFileSync('server/tests/workflow-engine.test.ts', c);
console.log('Fixed all bare method calls');
