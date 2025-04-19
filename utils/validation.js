// sanitizeInput.js
exports.sanitizeInput = (input) => {
    if (!input || typeof input !== 'string') return null; // Ensure input is a string
    return input.replace(/[^\w\s.-]/gi, ""); // Remove all non-word, non-space, non-period, and non-hyphen characters
};

exports.validateParams = (apiKey, platformId) => {
    console.log("apiKey length:", apiKey?.length);
    console.log("platformId length:", platformId?.length);

    if (!apiKey || !platformId) {
        return false
    }

    if (!/^[a-zA-Z0-9]{64}$/.test(apiKey)) {
        console.log("API key format invalid");
        return false
    }

    if (!/^[a-zA-Z0-9_]{32}$/.test(platformId)) {
        console.log("Platform ID format invalid");
        return false;
    }

    return true;
};

exports.generateUsername = (num) => {
    if (typeof num !== 'string' || num.length === 0) {
        return null; // Handle cases where the input is not a string or is empty
    }

    const lastDigit = num.slice(-1); // Get the last digit of the string
    return `2***${lastDigit}`; // Return the formatted username
};
