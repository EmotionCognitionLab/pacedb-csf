'use strict';

/**
 * Checks to make sure that the following are true. Exits with non-zero exit code if any are false:
 * 
 *  * There are no untracked files in the current directory hierarchy
 *  * There are no uncommitted files in the current directory hierarchy (with the exception of environment.prod.ts)
 *  * There are no staged but unpushed commits
 *  * All of the keys in environment.prod.ts have non-empty values.
 */
require('ts-node').register();
const { spawnSync } = require('child_process');
const prodEnvFile = 'src/environments/environment.prod.ts';
const prodEnv = require('../'+prodEnvFile).environment;

function getUncommittedFiles() {
    const git = spawnSync('git', ['ls-files', '--modified', '--other', '--exclude-standard']);
    const files = git.stdout.toString().split('\n');
    return files.filter(f => f !== prodEnvFile && f !== '');
}

function getUnpushedFiles() {
    const git = spawnSync('git', ['rev-list', 'HEAD', '^origin']);
    return git.stdout.toString();
}

function checkProdEnvSettings() {
    const errors = [];
    Object.keys(prodEnv).forEach(k => {
        if (prodEnv[k] === null || prodEnv[k] === '') {
            errors.push(k);
        }
    });
    return errors;
}

function main() {
    const uncommitted = getUncommittedFiles();
    if (uncommitted.length !== 0) {
        console.log(`Found uncommitted files. Please remove or commit before deploying:\n ${uncommitted}`);
        process.exit(1);
    }

    const unpushed = getUnpushedFiles();
    if (unpushed.length !== 0) {
        console.log(`Unpushed commits exist. Please push before deploying.`);
        process.exit(2);
    }

    const prodEnvErrs = checkProdEnvSettings();
    if (prodEnvErrs.length !== 0) {
        console.log('The following values are not set in environment.prod.ts. Please set them before continuing:')
        console.log(prodEnvErrs.join(', '));
        process.exit(3);
    }

    process.exit(0);
}

main();
