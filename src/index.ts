/**
 * ci-minecraft-forge-server-test
 * Copyright (C) 2017  Chikachi
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// tslint:disable-next-line:no-import-side-effect
import 'source-map-support/register';

import { spawn } from 'child_process';
import { access, constants, createReadStream, createWriteStream, mkdir, open, readFile, rmdir, writeFile } from 'fs';
import { get, IncomingMessage } from 'http';
import { basename, join } from 'path';
import { exit } from 'process';

import * as rimraf from 'rimraf';
import { lte, minor, patch } from 'semver';

import { CommandStep, IStep } from './step';

export type CurseForgeDependencyInfo = {
    module: string;
    version: string;
    extension: string;
    fileid: string;
};

export type ConfigCopyInfo = {
    filepath: string;
    relativeDestination?: string[];
};

export class CIMinecraftForgeServerTest {
    private serverDirectory = join('.', 'run');
    private tmpDirectory = join('.', 'tmp');

    private minecraftVersion: string = null;
    private minecraftSemver: string = null;

    private forgeVersion: string = null;
    private forgeInstallerFilename: string = null;
    private forgeInstallerUrl: string = null;
    private forgeUniversalFilename: string = null;

    private forgeInstalled: boolean = false;
    private eulaAccepted: boolean = false;
    private usingServerProperties: boolean = false;

    private javaPath: string = 'java';

    private mods: string[] = [];
    private configs: ConfigCopyInfo[] = [];
    private steps: IStep[] = [];
    private delayBeforeSteps: number = 1e2;
    private delayBetweenSteps: number = 1e2;
    private maxStartupTime: number = 3e5;

    private minecraftServer = null;
    private minecraftServerTimeout = null;

    /**
     * Set the version of Minecraft and Minecraft Forge
     * @param minecraftVersion Minecraft version
     * @param forgeVersion Minecraft Forge version
     */
    public setVersions(minecraftVersion: string, forgeVersion: string) {
        this.minecraftVersion = minecraftVersion;
        this.forgeVersion = forgeVersion;

        this.minecraftSemver = minecraftVersion;

        if (this.minecraftVersion.split('.').length === 2) {
            this.minecraftSemver += '.0';
        }

        if (lte(this.minecraftSemver, '1.7.10')) {
            forgeVersion = `${minecraftVersion}-${forgeVersion}-${minecraftVersion}`;
        } else {
            forgeVersion = `${minecraftVersion}-${forgeVersion}`;
        }

        this.forgeUniversalFilename = `forge-${forgeVersion}-universal.jar`;
        this.forgeInstallerFilename = `forge-${forgeVersion}-installer.jar`;
        // tslint:disable-next-line:max-line-length
        // tslint:disable-next-line:no-http-string
        this.forgeInstallerUrl = `http://files.minecraftforge.net/maven/net/minecraftforge/forge/${forgeVersion}/${this.forgeInstallerFilename}`;

        return this;
    }

    /**
     * Set the path to the server
     * Defaults to run in current folder
     * @param path Filepath
     */
    public setServerDirectory(path: string) {
        if (this.forgeInstalled) {
            throw new Error('Forge have already been installed. Set server directory before installing Forge!');
        }

        this.serverDirectory = path;

        return this;
    }

    /**
     * Set the path to the java executable
     * Defaults to execute "java"
     * @param path Path to java executable
     */
    public setJavaPath(javaPath: string) {
        this.javaPath = javaPath;

        return this;
    }

    /**
     * Add a mod from local file
     * @param filepath Path to mod file
     */
    public addLocalMod(filepath: string) {
        this.mods.push(filepath);

        return this;
    }

    /**
     * Download and add a mod from CurseForge
     * @param modInfo Informations about the mod.
     */
    public addCurseMod(modInfo: CurseForgeDependencyInfo) {
        return this.ensureFolderExists(this.tmpDirectory)
            .then(() => this.downloadCurseMod(modInfo));
    }

    /**
     * Add config file from local file
     * @param filepath Path to config file.
     * @param relativeDestination Relative destination path from the configs folder.
     */
    public addConfigFile(filepath: string, relativeDestination?: string[]) {
        this.configs.push({
            filepath,
            relativeDestination,
        });

        return this;
    }

    /**
     * Add command step to list of steps to be executed
     * @param commands Command to be added
     */
    public addCommand(command: string) {
        this.steps.push(new CommandStep(command));

        return this;
    }

    /**
     * Add step to list of steps to be executed
     * @param step Step to be added
     */
    public addStep(step: IStep) {
        this.steps.push(step);

        return this;
    }

    /**
     * Set the delay between server reporting Done starting and first command being executed
     * @param delay Milliseconds
     */
    public setDelayBeforeCommands(delay: number) {
        this.delayBeforeSteps = delay;

        return this;
    }

    /**
     * Set the delay between each command being executed
     * @param delay Milliseconds
     */
    public setDelayBetweenCommands(delay: number) {
        this.delayBetweenSteps = delay;

        return this;
    }

    /**
     * Set the amount of milliseconds before killing the server unless "Done" message received
     * @param time Milliseconds
     */
    public setMaxStartupTime(time: number) {
        this.maxStartupTime = time;

        return this;
    }

    /**
     * Install Minecraft Forge
     */
    public installForge() {
        if (this.minecraftVersion == null) {
            throw new Error('Minecraft version not set');
        }
        if (this.forgeVersion == null) {
            throw new Error('Forge version not set');
        }

        const jarFilepath = join(this.serverDirectory, this.forgeUniversalFilename);
        const installerFilepath = join(this.serverDirectory, this.forgeInstallerFilename);

        return this.ensureFolderExists(this.serverDirectory)
            .then(() => {
                return new Promise
                    ((resolve, reject) => {
                        open(jarFilepath, 'wx', (err, fd) => {
                            if (err && err.code === 'EEXIST') {
                                // Forge already installed
                                this.forgeInstalled = true;
                                resolve(false);

                                return;
                            }

                            // Downloading Forge installer
                            const installerFilestream = createWriteStream(installerFilepath);
                            get(this.forgeInstallerUrl, (res: IncomingMessage) => {
                                res.pipe(installerFilestream);
                                res.on('end', () => resolve(true));
                            });
                        });
                    });
            })
            .then(install => {
                if (!install) {
                    return;
                }

                return new Promise((resolve, reject) => {
                    // Installing Forge
                    const installer = spawn(
                        this.javaPath,
                        [
                            '-jar',
                            this.forgeInstallerFilename,
                            '--installServer',
                        ],
                        {
                            cwd: this.serverDirectory,
                        },
                    );

                    installer.on('close', code => {
                        if (code !== 0) {
                            reject('Installer failed');

                            return;
                        }

                        // Forge installed
                        this.forgeInstalled = true;
                        resolve();
                    });
                });
            });
    }

    /**
     * Accept Minecraft's EULA.
     * Can be found at https://account.mojang.com/documents/minecraft_eula
     */
    public acceptEULA() {
        this.eulaAccepted = true;

        return this;
    }

    /**
     * Use simple server.properties with a lot disabled to try speed up things.
     */
    public useServerProperties() {
        this.usingServerProperties = true;

        return this;
    }

    /**
     * Start the server
     */
    public runServer() {
        if (this.minecraftVersion == null) {
            throw new Error('Minecraft version not set');
        }
        if (this.forgeVersion == null) {
            throw new Error('Forge version not set');
        }
        if (!this.forgeInstalled) {
            throw new Error('Forge not installed');
        }
        if (!this.eulaAccepted) {
            throw new Error(`You haven't accepted Minecraft's EULA!`);
        }

        return Promise.resolve()
            .then(() => this.writeServerProperties())
            .then(() => this.writeEula())
            .then(() => this.removeOldData())
            .then(() => this.copyConfigs())
            .then(() => this.copyMods())
            .then(() => this.startServer());
    }

    private ensureFolderExists(path: string) {
        return new Promise
            ((resolve, reject) => {
                access(path, constants.F_OK | constants.W_OK, err => {
                    if (err != null) {
                        mkdir(path, err2 => {
                            err2 != null ? reject(err2) : resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            });
    }

    private downloadCurseMod(modInfo: CurseForgeDependencyInfo) {
        const fileIdSplit = `${parseInt(modInfo.fileid.substring(0, 4), 10)}/${parseInt(modInfo.fileid.substring(4), 10)}`;
        const filepath = join(this.tmpDirectory, `${modInfo.module}-${modInfo.version}.${modInfo.extension}`);

        const dest = createWriteStream(filepath);

        return new Promise((resolve, reject) => {
            get(
                `https://addons-origin.cursecdn.com/files/${fileIdSplit}/${modInfo.module}-${modInfo.version}.${modInfo.extension}`,
                (res: IncomingMessage) => {
                    res.pipe(dest);
                    res.on('end', () => resolve(true));
                },
            );
        });
    }

    private removeOldData() {
        const removePromises = [];
        const foldersToRemove = [
            'config',
            'crash-reports',
            'logs',
            'mods',
        ];

        for (const folderToRemove of foldersToRemove) {
            removePromises.push(new Promise((resolve, reject) => {
                rimraf(join(this.serverDirectory, folderToRemove), err => {
                    resolve();
                });
            }));
        }

        return Promise.all(removePromises);
    }

    private startServer() {
        return new Promise
            ((resolve, reject) => {
                this.minecraftServer = spawn(
                    this.javaPath,
                    [
                        '-jar',
                        this.forgeUniversalFilename,
                        '--',
                        'nogui',
                    ],
                    {
                        cwd: this.serverDirectory,
                    },
                );

                let errored = true;

                this.minecraftServerTimeout = setTimeout(
                    () => {
                        this.minecraftServer.kill();
                    },
                    this.maxStartupTime,
                );

                this.minecraftServer.stdout.on('data', data => {
                    // tslint:disable-next-line:no-console
                    console.log(data.toString().trim());
                    if (data.toString().split(': Done (').length > 1) {
                        errored = false;
                        clearTimeout(this.minecraftServerTimeout);
                        setTimeout(
                            () => {
                                this.executeNextStep();
                            },
                            this.delayBeforeSteps,
                        );
                    }
                    if (data.toString().split('Fatal errors were detected during the transition').length > 1) {
                        errored = true;
                    }
                });

                this.minecraftServer.stderr.on('data', data => {
                    // tslint:disable-next-line:no-console
                    console.error(data.toString().trim());
                });

                this.minecraftServer.on('close', code => {
                    if (code !== 0 || errored) {
                        return reject('Minecraft crashed or took to long');
                    }

                    resolve();
                });
            });
    }

    private executeNextStep() {
        setTimeout(
            () => {
                if (this.steps.length === 0) {
                    // Stop the server as all steps have been executed
                    this.minecraftServer.stdin.write('stop\n');

                    return;
                }

                this.steps
                    .shift()
                    .execute(this.minecraftServer)
                    .then(() => {
                        this.executeNextStep();
                    });
            },
            this.delayBetweenSteps,
        );
    }

    private writeServerProperties() {
        if (!this.usingServerProperties) {
            return;
        }

        return new Promise
            ((resolve, reject) => {
                writeFile(
                    join(this.serverDirectory, 'server.properties'),
                    `allow-nether=false
server-port=${35565 + (minor(this.minecraftSemver) * 10) + patch(this.minecraftSemver)}
spawn-npcs=false
white-list=true
spawn-animals=false
snooper-enabled=false
online-mode=false
max-players=1
spawn-monsters=false
generate-structures=false`,
                    err => {
                        if (err != null) {
                            return reject(err);
                        }

                        this.usingServerProperties = true;
                        resolve();
                    },
                );
            });
    }

    private writeEula() {
        return new Promise
            ((resolve, reject) => {
                writeFile(
                    join(this.serverDirectory, 'eula.txt'),
                    'eula=true',
                    err => {
                        if (err != null) {
                            return reject(err);
                        }

                        resolve();
                    },
                );
            });
    }

    private copyMods() {
        return this.ensureFolderExists(join(this.serverDirectory, 'mods'))
            .then(() => {
                const copyPromises = [];

                for (const modPath of this.mods) {
                    copyPromises.push(this.copyFile(modPath, join(this.serverDirectory, 'mods', basename(modPath))));
                }

                return Promise.all(copyPromises);
            });
    }

    private copyConfigs() {
        return this.ensureFolderExists(join(this.serverDirectory, 'config'))
            .then(async () => {
                const copyPromises = [];

                for (const config of this.configs) {
                    let destination = join(
                        this.serverDirectory,
                        'config',
                    );

                    if (config.relativeDestination != null) {
                        for (const destinationPart of config.relativeDestination) {
                            destination = join(destination, destinationPart);
                            await this.ensureFolderExists(destination);
                        }
                    }

                    destination = join(destination, basename(config.filepath));

                    copyPromises.push(this.copyFile(config.filepath, destination));
                }

                return Promise.all(copyPromises);
            });
    }

    private copyFile(fromPath, toPath) {
        return new Promise((resolve, reject) => {
            let errored = false;
            const readStream = createReadStream(fromPath);
            readStream.on('error', () => {
                errored = true;
                reject(`Could not read file : ${basename(fromPath)}`);
            });
            const writeStream = createWriteStream(toPath);
            readStream.on('error', () => {
                errored = true;
                reject(`Could not write file : ${basename(fromPath)}`);
            });
            writeStream.on('close', () => {
                if (!errored) {
                    resolve();
                }
            });
            readStream.pipe(writeStream);
        });
    }
}
