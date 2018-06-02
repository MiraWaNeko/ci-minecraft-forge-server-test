export interface IStep {
  execute(minecraftServer: any): Promise<any>;
}

export class CommandStep implements IStep {
  private command: string;

  public constructor(command: string) {
    this.command = command;
  }

  public async execute(minecraftServer: any) {
    minecraftServer.stdin.write(`${this.command}\n`);
  }
}

export class AwaitStep implements IStep {
  private text: string;
  private ttl?: number;

  public constructor(text: string, ttl?: number) {
    this.text = text;
    this.ttl = ttl;
  }

  public async execute(minecraftServer: any) {
    return new Promise((resolve, reject) => {
      let timeout = null;

      const handleData = data => {
        if (data.toString().split(this.text).length > 1) {
          resolve();
          if (timeout != null) {
            clearTimeout(timeout);
          }
        }
      };

      if (this.ttl != null) {
        timeout = setTimeout(
          () => {
            minecraftServer.stdout.off('data', handleData);
            reject();
          },
          this.ttl,
        );
      }

      minecraftServer.stdout.on('data', handleData);
    });
  }
}
