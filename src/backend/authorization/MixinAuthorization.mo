import AccessControl "./access-control";
import Prim "mo:prim";
import Principal "mo:core/Principal";

mixin (accessControlState : AccessControl.AccessControlState) {
  // Register authenticated callers on first login. The configured bootstrap
  // token grants admin only to the first caller who supplies the exact token.
  // If no token is configured, callers are still registered as regular users.
  public shared ({ caller }) func _initializeAccessControlWithSecret(userSecret : Text) : async () {
    let adminToken = switch (Prim.envVar<system>("CLOUDSENTINELS_ADMIN_TOKEN")) {
      case (null) { "" };
      case (?token) { token };
    };
    AccessControl.initialize(accessControlState, caller, adminToken, userSecret);
  };

  public query ({ caller }) func getCallerUserRole() : async AccessControl.UserRole {
    AccessControl.getUserRole(accessControlState, caller);
  };

  public shared ({ caller }) func assignCallerUserRole(user : Principal, role : AccessControl.UserRole) : async () {
    AccessControl.assignRole(accessControlState, caller, user, role);
  };

  public query ({ caller }) func isCallerAdmin() : async Bool {
    AccessControl.isAdmin(accessControlState, caller);
  };
};
