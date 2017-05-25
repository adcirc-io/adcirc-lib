import node from 'rollup-plugin-node-resolve';

var os = require( 'os' ),
    fs = require( 'fs' );

var json = JSON.parse( fs.readFileSync("package.json", "utf8") );
var preamble = "// " + (json.homepage || json.name)
    + " Version " + json.version + "."
    + " Copyright " + (new Date).getFullYear()
    + " " + json.author.name + (/\.$/.test(json.author.name) ? "" : ".")
    + os.EOL;

export default {
    entry: 'index.js',
    format: 'umd',
    moduleName: 'adcirc',
    banner: preamble,
    plugins: [ node() ],
    dest: 'build/adcirc-lib.js'
}