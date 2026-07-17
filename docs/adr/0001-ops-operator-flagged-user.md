# Operator access via flagged product User

Ops Console access uses the existing User session. A User with `isOperator` set is an Operator; there is no separate Operator identity or env allowlist in v1.

We chose this over a shared ops secret or SSO because the Operator set is tiny, sessions already exist, and revoke/grant can happen in the DB without a new auth system. The trade-off is that Operators are also product Users and inherit that account’s normal capabilities outside `/ops`.
