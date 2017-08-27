## ci-minecraft-forge-server-test

Tool for testing Minecraft Forge servers as part of testing on CI servers.

This handles installing Minecraft Forge, copy/download mods, starting the server, running commands and stopping the server again.

### Example script

The following is an example script.

```typescript
import { readFile } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { exit } from 'process';

import { CIMinecraftForgeServerTest } from 'ci-minecraft-forge-server-test';

const buildLibsDirectory = pathResolve('..', 'build', 'libs');
const serverDirectory = pathResolve('..', 'run');

let minecraftVersion = null;
let forgeVersion = null;

let modFilepath = null;

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

            modFilepath = join(buildLibsDirectory, `DiscordIntegration-mc${minecraftVersion}-${modVersion}.jar`);

            resolve();
        });
    });
}

const tester = new CIMinecraftForgeServerTest();
getVersions()
    .then(() => {
        tester
            .setVersions(minecraftVersion, forgeVersion)
            .acceptEULA()
            .useServerProperties()
            .setServerDirectory(serverDirectory)
            .addLocalMod(modFilepath)
            .addCommand('forge tps');

        return tester.installForge()
            .then(() => tester.runServer());
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