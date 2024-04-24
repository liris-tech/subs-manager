Package.describe({
  name: 'liristech:subs-manager',
  version: '0.0.3',
  summary: 'A manager for Meteor subscriptions',
  git: '',
  documentation: 'README.md'
});

Npm.depends({
  lodash: '4.17.21'
});

Package.onUse(function(api) {
  api.versionsFrom('2.15');
  api.use('ecmascript');
  api.mainModule('client.js', 'client');
});