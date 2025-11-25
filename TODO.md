c# TODO: Add OTP to Login and Improve ToastBox

## Backend Changes
- [x] Modify /api/login in server.js to generate and send OTP, store hash and expiry
- [x] Add new endpoint /api/verify-login-otp in server.js for login OTP verification

## Frontend Changes
- [x] Update login form submission in login.js to call modified /api/login, show OTP form on success
- [x] Update OTP form in login.js to use /api/verify-login-otp for login verification
- [x] Change 'notification' class to 'toast' in showNotification function in login.js

## Styling Changes
- [x] Add initial state for .toast in auth.css with transform: translateX(100%) and opacity: 0
- [x] Add .toast.show in auth.css with opacity: 1 and transform: translateX(0)

## Testing
- [x] Test the login with OTP flow
- [x] Verify toast notifications appear correctly
