// Point d'entrée `--import` : installe le hook de résolution des tests.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
