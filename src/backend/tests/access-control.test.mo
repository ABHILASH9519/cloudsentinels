import AccessControl "../authorization/access-control";
import Principal "mo:core/Principal";

let admin = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let regularUser = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let laterCaller = Principal.fromText("rwlgt-iiaaa-aaaaa-aaaaa-cai");

let configuredState = AccessControl.initState();
AccessControl.initialize(configuredState, admin, "test-bootstrap-secret", "test-bootstrap-secret");
assert AccessControl.isAdmin(configuredState, admin);

AccessControl.initialize(configuredState, regularUser, "test-bootstrap-secret", "");
assert (AccessControl.getUserRole(configuredState, regularUser) == #user);
assert (not AccessControl.hasPermission(configuredState, regularUser, #admin));
assert AccessControl.hasPermission(configuredState, regularUser, #user);

// A later caller cannot claim admin, even if they know the bootstrap token.
AccessControl.initialize(configuredState, laterCaller, "test-bootstrap-secret", "test-bootstrap-secret");
assert (AccessControl.getUserRole(configuredState, laterCaller) == #user);
assert (not AccessControl.isAdmin(configuredState, laterCaller));

// With no configured token, registration remains available but admin is never granted.
let noSecretState = AccessControl.initState();
AccessControl.initialize(noSecretState, regularUser, "", "");
assert (AccessControl.getUserRole(noSecretState, regularUser) == #user);
assert (not AccessControl.isAdmin(noSecretState, regularUser));

// An incorrect token cannot claim admin.
let wrongTokenState = AccessControl.initState();
AccessControl.initialize(wrongTokenState, admin, "expected-secret", "wrong-secret");
assert (AccessControl.getUserRole(wrongTokenState, admin) == #user);
assert (not AccessControl.isAdmin(wrongTokenState, admin));

debug_show("Access-control tests passed");
