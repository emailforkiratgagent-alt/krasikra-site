import * as migration_20261031_092140_initial from './20261031_092140_initial';

export const migrations = [
  {
    up: migration_20261031_092140_initial.up,
    down: migration_20261031_092140_initial.down,
    name: '20261031_092140_initial'
  },
];
