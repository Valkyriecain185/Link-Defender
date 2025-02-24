const express = require("express"),
  CheckAuth = require("../auth/CheckAuth"),
  router = express.Router();

// Route for the homepage
router.get("/", CheckAuth, async (req, res) => {
  res.render("manager/home", {
    user: req.userInfos, // Pass user data if available
    guild: req.guild // Pass guild data if available
  });
});

router.get("/selector", CheckAuth, async (req, res) => {
  res.render("selector", {
    user: req.userInfos,
    currentURL: `${req.client.config.DASHBOARD.baseURL}/${req.originalUrl}`,
  });
});

module.exports = router;
