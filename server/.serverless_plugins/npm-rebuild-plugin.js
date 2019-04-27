'use strict';

const child_process = require('child_process');
/**
 * Uses a docker instance to do an npm rebuild for functions that have native code
 * that must be compiled for an AWS Lambda linux instance (rather than whatever OS the deployment environment
 * is running in). The modules are recompiled for the local environment after deployment.
 */
class NpmRebuildPlugin {
    constructor(serverless, options) {

        this.hooks = {
            'before:package:initialize': this.beforePackage.bind(this),
            'after:aws:deploy:finalize:cleanup': this.afterDeploy.bind(this),
            'before:package:function:package': this.beforePackage.bind(this, options),
            'after:deploy:function:deploy': this.afterDeploy.bind(this, options)
        };

        // add functions that require native code compilation here
        // { funcName (in serverless.yml): funcDirectory }
        this.funcsWithNativeCode = {
            'dataImporter': 'training-data-import',
            'spreadsheetUpdater': 'training-data-import',
            'calibrationData': 'calibration'
         };
    }

    beforePackage(options) {
        const funcPathsToCompile = this.funcPathsForOptions(options);
        funcPathsToCompile.forEach(f => {
            console.log(`Recompiling ${f} node_modules for use on AWS; don't worry about the warnings...`);
            child_process.spawnSync('docker', ['run', '--rm', '-v', `"$PWD/${f}":/var/task`, 'lambci/lambda:build-nodejs8.10'], {stdio: 'inherit', shell: true});
        }); 
    }

    afterDeploy(options) {
        const funcPathsToCompile = this.funcPathsForOptions(options);
        funcPathsToCompile.forEach(f => {
            console.log(`Recompiling ${f} node_modules for local use...`);
            child_process.spawnSync('npm', ['rebuild'], {cwd: f, stdio: 'inherit'});
        });
    }

    /**
     * If we're compiling a single function, return the path for that function.
     * Otherwise, return the paths for all functions that have native code.
     * @param {*} options 
     */
    funcPathsForOptions(options) {
        if (!options) {
            return Object.keys(this.funcsWithNativeCode).map(k => this.funcsWithNativeCode[k]);
        } else if (options.function && this.funcsWithNativeCode[options.function]) {
            return [this.funcsWithNativeCode[options.function]];
        } else {
            return [];
        }
    }

}

module.exports = NpmRebuildPlugin;