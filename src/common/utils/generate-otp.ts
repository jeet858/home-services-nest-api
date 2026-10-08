// Numeric OTP, same as src/utils/generateOtp.util.js.
export const generateOTP = (length = 4) => {
  const chars = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return otp;
};
