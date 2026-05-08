import chalk from 'chalk';
import ora, { Ora } from 'ora';

export function info(message: string): void {
  console.log(chalk.cyan(`ℹ ${message}`));
}

export function success(message: string): void {
  console.log(chalk.green(`✔ ${message}`));
}

export function warn(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

export function error(message: string): void {
  console.log(chalk.red(`✖ ${message}`));
}

export function header(title: string): void {
  console.log('');
  console.log(chalk.cyan('========================================'));
  console.log(chalk.cyan(`  ${title}`));
  console.log(chalk.cyan('========================================'));
  console.log('');
}

export function spinner(text: string): Ora {
  return ora(text).start();
}

export function newLine(): void {
  console.log('');
}
