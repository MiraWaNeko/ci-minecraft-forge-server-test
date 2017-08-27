## ci-minecraft-forge-server-test

Tool for testing Minecraft Forge servers as part of testing on CI servers.

This handles installing Minecraft Forge, copy/download mods, starting the server, running commands and stopping the server again.

### How to
This is only a library and will need to be executed by other code (See example code below), as different projects will have different requirements for the server testing.

To run the code on a Jenkins CI server, simply add `sh 'npm install'` and `sh 'npm start'` as a step in your `Jenkinsfile`.
**Tip:** You can archive the log file as a `post` action.

#### Example Jenkinsfile
```
pipeline {
  agent any
  options {
    timeout(time: 30, unit: 'MINUTES')
  }
  tools {
    jdk 'jdk_8u144'
    nodejs 'node_8.4.0'
  }
  stages {
    stage('Prepare') {
      steps {
        sh 'chmod +x gradlew'
        sh './gradlew setupCiWorkspace clean'
      }
    }
    stage('Build') {
      steps {
        sh './gradlew build jar'
      }
    }
    stage('Run Server Test') {
      steps {
        dir('serverTest') {
          sh 'npm install'
          sh 'npm start'
        }
      }
      post {
        always {
          archiveArtifacts 'run/logs/fml-server-latest.log'
        }
      }
    }
    stage('Archive') {
      steps {
        archiveArtifacts 'build/libs/*.jar'
        fingerprint 'build/libs/*.jar'
      }
    }
  }
}
``` 


### Example code

The following is an example code that use this library.

```typescript
import { readFile } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { exit } from 'process';

import { CIMinecraftForgeServerTest } from 'ci-minecraft-forge-server-test';

const buildLibsDirectory = pathResolve('..', 'build', 'libs');
const serverDirectory = pathResolve('..', 'run');

// Minecraft and Forge versions
let minecraftVersion = null;
let forgeVersion = null;
// Path to mod .jar file
let modFilepath = null;

// Get the Minecraft, Forge and mod versions from build.gradle
function getVersions() {
    return new Promise((resolve, reject) => {
        readFile(pathResolve('..', 'build.gradle'), 'UTF-8', (err, data) => {
            if (err != null) {
                reject(err);
                return;
            }

            let modVersion = null;

            data
                .split('\n')
                .forEach((line, i) => {
                    if (line.startsWith('def')) {
                        const varName = line.split(' ')[1];
                        const varValue = line.split('\'')[1];

                        if (varName === 'mcVersion') {
                            minecraftVersion = varValue;
                        } else if (varName === 'forgeVersion') {
                            forgeVersion = varValue;
                        } else if (varName === 'modVersion') {
                            modVersion = varValue;
                        }
                    }
                });

            if (minecraftVersion == null || forgeVersion == null) {
                reject('Could not find Minecraft and/or Forge version');
                return;
            }

            if (modVersion == null) {
                reject('Could not find mod version');
                return;
            }

            modFilepath = join(buildLibsDirectory, `ModName-mc${minecraftVersion}-${modVersion}.jar`);
            resolve();
        });
    });
}

// Create instance of ci-minecraft-forge-server-test
const tester = new CIMinecraftForgeServerTest();
getVersions()
    .then(() => {
        tester
            .setVersions(minecraftVersion, forgeVersion) // Set versions
            //.acceptEULA()                              // Accept Minecraft's EULA (commented out to prevent blindingly accepting by copy/paste)
            .useServerProperties()                       // Use ci-minecraft-forge-server-test's server.properties file
            .setServerDirectory(serverDirectory)         // Set the directory for the server
            .addLocalMod(modFilepath)                    // Add the mod
            .addCommand('forge tps');                    // Add command to run

        return tester.installForge()                     // Install Forge
            .then(() => tester.runServer());             // Run the server
    })
    .catch(err => {
        console.error(err);
        exit(1);
    });

```

For this to work, the minecraft/forge/mod versions must be defined in the `build.gradle` file.
```groovy
def mcVersion = '1.12'
def forgeVersion = '14.21.1.2387'
def modVersion = '1.0.0'
```

When the server is started it executes `forge tps` before executing `stop` (automaticly done by the library).