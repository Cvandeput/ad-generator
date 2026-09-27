// Doublure du paquet `stripe` pour tests/cancel-subscription.test.js : aucun
// appel réseau. Le constructeur rend l'objet que le test a posé dans
// `globalThis.__stripeFake` — billing/stripe.js garde le client en cache, le
// test fait donc varier le COMPORTEMENT de cet objet, jamais l'objet lui-même.
export default class Stripe {
  constructor() {
    return globalThis.__stripeFake;
  }
}
