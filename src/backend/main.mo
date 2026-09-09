import Int "mo:core/Int";
import Float "mo:core/Float";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Map "mo:core/Map";
import List "mo:core/List";
import Order "mo:core/Order";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import AccessControl "authorization/access-control";
import Iter "mo:core/Iter";
import MixinAuthorization "authorization/MixinAuthorization";

actor {
  // Use prefabricated authorization component
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  // User profile type
  public type UserProfile = {
    name : Text;
  };

  let userProfiles = Map.empty<Principal, UserProfile>();

  // User profile management
  public query ({ caller }) func getCallerUserProfile() : async ?UserProfile {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can access profiles");
    };
    userProfiles.get(caller);
  };

  public query ({ caller }) func getUserProfile(user : Principal) : async ?UserProfile {
    if (caller != user and not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Can only view your own profile");
    };
    userProfiles.get(user);
  };

  public shared ({ caller }) func saveCallerUserProfile(profile : UserProfile) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save profiles");
    };
    userProfiles.add(caller, profile);
  };

  // Data models
  type IncidentId = Nat;
  type CommentId = Nat;
  type MetricPointId = Nat;
  type AlertId = Nat;

  type Incident = {
    id : IncidentId;
    title : Text;
    severity : Text;
    status : Text;
    source : Text;
    rawLog : Text;
    aiSummary : Text;
    rootCause : Text;
    suggestedFix : Text;
    assignee : Text;
    createdAt : Int;
    updatedAt : Int;
  };

  module Incident {
    public func compare(incident1 : Incident, incident2 : Incident) : Order.Order {
      Nat.compare(incident1.id, incident2.id);
    };
  };

  type Comment = {
    id : CommentId;
    incidentId : IncidentId;
    author : Text;
    text : Text;
    createdAt : Int;
  };

  type MetricPoint = {
    id : MetricPointId;
    name : Text;
    value : Float;
    unit : Text;
    timestamp : Int;
    source : Text;
  };

  module MetricPoint {
    public func compare(metric1 : MetricPoint, metric2 : MetricPoint) : Order.Order {
      switch (Text.compare(metric1.name, metric2.name)) {
        case (#equal) { Nat.compare(metric1.id, metric2.id) };
        case (order) { order };
      };
    };

    public func compareByTimestamp(metric1 : MetricPoint, metric2 : MetricPoint) : Order.Order {
      Int.compare(metric1.timestamp, metric2.timestamp);
    };
  };

  type Alert = {
    id : AlertId;
    title : Text;
    severity : Text;
    source : Text;
    message : Text;
    status : Text;
    timestamp : Int;
  };

  module Alert {
    public func compare(alert1 : Alert, alert2 : Alert) : Order.Order {
      Nat.compare(alert1.id, alert2.id);
    };
  };

  type DashboardSummary = {
    incidentsByStatus : [(Text, Nat)];
    incidentsBySeverity : [(Text, Nat)];
    activeAlertsCount : Nat;
    latestMetrics : [MetricPoint];
  };

  // Persistent data stores
  let incidents = Map.empty<IncidentId, Incident>();
  let comments = Map.empty<CommentId, Comment>();
  let metrics = Map.empty<MetricPointId, MetricPoint>();
  let alerts = Map.empty<AlertId, Alert>();

  var nextIncidentId : IncidentId = 1;
  var nextCommentId : CommentId = 1;
  var nextMetricId : MetricPointId = 1;
  var nextAlertId : AlertId = 1;

  // Helper functions
  func checkIncidentExists(id : IncidentId) : () {
    if (not incidents.containsKey(id)) {
      Runtime.trap("Incident with id: " # id.toText() # " does not exist");
    };
  };

  // Incident management
  public shared ({ caller }) func createIncident(title : Text, severity : Text, source : Text, rawLog : Text) : async IncidentId {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can create incidents");
    };

    let id = nextIncidentId;
    let now = Time.now();
    let incident : Incident = {
      id;
      title;
      severity;
      source;
      rawLog;
      status = "open";
      aiSummary = "";
      rootCause = "";
      suggestedFix = "";
      assignee = "";
      createdAt = now;
      updatedAt = now;
    };

    incidents.add(id, incident);
    nextIncidentId += 1;
    id;
  };

  public query ({ caller }) func getIncident(id : IncidentId) : async Incident {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view incidents");
    };

    switch (incidents.get(id)) {
      case (null) { Runtime.trap("Incident with id: " # id.toText() # " does not exist") };
      case (?incident) { incident };
    };
  };

  public query ({ caller }) func listIncidents() : async [Incident] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can list incidents");
    };

    incidents.values().toArray().sort();
  };

  public shared ({ caller }) func updateIncidentStatus(id : IncidentId, status : Text) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can update incidents");
    };

    checkIncidentExists(id);

    switch (incidents.get(id)) {
      case (null) { Runtime.trap("Incident with id: " # id.toText() # " does not exist") };
      case (?incident) {
        let updatedIncident : Incident = {
          id = incident.id;
          title = incident.title;
          severity = incident.severity;
          status;
          source = incident.source;
          rawLog = incident.rawLog;
          aiSummary = incident.aiSummary;
          rootCause = incident.rootCause;
          suggestedFix = incident.suggestedFix;
          assignee = incident.assignee;
          createdAt = incident.createdAt;
          updatedAt = Time.now();
        };
        incidents.add(id, updatedIncident);
      };
    };
  };

  public shared ({ caller }) func updateIncidentAIFields(id : IncidentId, aiSummary : Text, rootCause : Text, suggestedFix : Text) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can update AI fields");
    };

    checkIncidentExists(id);

    switch (incidents.get(id)) {
      case (null) { Runtime.trap("Incident with id: " # id.toText() # " does not exist") };
      case (?incident) {
        let updatedIncident : Incident = {
          id = incident.id;
          title = incident.title;
          severity = incident.severity;
          status = incident.status;
          source = incident.source;
          rawLog = incident.rawLog;
          aiSummary;
          rootCause;
          suggestedFix;
          assignee = incident.assignee;
          createdAt = incident.createdAt;
          updatedAt = Time.now();
        };
        incidents.add(id, updatedIncident);
      };
    };
  };

  public shared ({ caller }) func deleteIncident(id : IncidentId) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admin can delete incidents");
    };

    checkIncidentExists(id);

    incidents.remove(id);
  };

  // Comment management
  public shared ({ caller }) func addComment(incidentId : IncidentId, author : Text, text : Text) : async CommentId {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can add comments");
    };

    checkIncidentExists(incidentId);

    let id = nextCommentId;
    let comment : Comment = {
      id;
      incidentId;
      author;
      text;
      createdAt = Time.now();
    };

    comments.add(id, comment);
    nextCommentId += 1;
    id;
  };

  public query ({ caller }) func getCommentsByIncident(incidentId : IncidentId) : async [Comment] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view comments");
    };

    comments.values().toArray().filter(func(c) { c.incidentId == incidentId });
  };

  // Metric ingestion
  public shared ({ caller }) func addMetric(name : Text, value : Float, unit : Text, source : Text) : async MetricPointId {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can add metrics");
    };

    let id = nextMetricId;
    let metric : MetricPoint = {
      id;
      name;
      value;
      unit;
      timestamp = Time.now();
      source;
    };

    metrics.add(id, metric);
    nextMetricId += 1;
    id;
  };

  public query ({ caller }) func getMetricsByName(name : Text) : async [MetricPoint] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view metrics");
    };

    metrics.values().toArray().filter(func(m) { m.name == name });
  };

  public query ({ caller }) func getRecentMetrics(count : Nat) : async [MetricPoint] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view metrics");
    };

    let allMetrics = metrics.values().toArray();
    let sorted = allMetrics.sort(MetricPoint.compareByTimestamp);

    let sortedList = List.fromArray<MetricPoint>(sorted);
    let iter = sortedList.reverse().values();
    iter.take(count).toArray();
  };

  // Alert management
  public shared ({ caller }) func addAlert(title : Text, severity : Text, source : Text, message : Text) : async AlertId {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can add alerts");
    };

    let id = nextAlertId;
    let alert : Alert = {
      id;
      title;
      severity;
      source;
      message;
      status = "active";
      timestamp = Time.now();
    };

    alerts.add(id, alert);
    nextAlertId += 1;
    id;
  };

  public query ({ caller }) func getAlerts() : async [Alert] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view alerts");
    };

    alerts.values().toArray().sort();
  };

  public shared ({ caller }) func updateAlertStatus(id : AlertId, status : Text) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can update alerts");
    };

    switch (alerts.get(id)) {
      case (null) { Runtime.trap("Alert with id: " # id.toText() # " does not exist") };
      case (?alert) {
        let updatedAlert : Alert = {
          id = alert.id;
          title = alert.title;
          severity = alert.severity;
          source = alert.source;
          message = alert.message;
          status;
          timestamp = alert.timestamp;
        };
        alerts.add(id, updatedAlert);
      };
    };
  };

  public query ({ caller }) func getActiveAlerts() : async [Alert] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view alerts");
    };

    alerts.values().toArray().filter(func(a) { a.status == "active" });
  };

  // Dashboard summary
  public query ({ caller }) func getDashboardSummary() : async DashboardSummary {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view dashboard");
    };

    // Count incidents by status
    let statusMap = Map.empty<Text, Nat>();
    for (incident in incidents.values()) {
      let currentCount = switch (statusMap.get(incident.status)) {
        case (null) { 0 };
        case (?count) { count };
      };
      statusMap.add(incident.status, currentCount + 1);
    };

    // Count incidents by severity
    let severityMap = Map.empty<Text, Nat>();
    for (incident in incidents.values()) {
      let currentCount = switch (severityMap.get(incident.severity)) {
        case (null) { 0 };
        case (?count) { count };
      };
      severityMap.add(incident.severity, currentCount + 1);
    };

    // Count active alerts
    let activeAlertsCount = alerts.values().toArray().filter(func(a) { a.status == "active" }).size();

    // Get latest metrics (last 10)
    let allMetrics = metrics.values().toArray();
    let sorted = allMetrics.sort(MetricPoint.compareByTimestamp);
    let sortedList = List.fromArray<MetricPoint>(sorted);
    let latestMetrics = sortedList.reverse().values().take(10).toArray();

    {
      incidentsByStatus = statusMap.entries().toArray();
      incidentsBySeverity = severityMap.entries().toArray();
      activeAlertsCount;
      latestMetrics;
    };
  };
};
