const express = require("express"),
  CheckAuth = require("../auth/CheckAuth"),
  router = express.Router();

router.get("/", CheckAuth, async (req, res) => {
  res.redirect("/selector");
});

router.get("/selector", CheckAuth, async (req, res) => {
  try {
    const guild = req.client.guilds.cache.get('1341915395379953704');
    const member = await guild.members.fetch(req.user.id); // Assuming req.user.id contains the Discord user ID

    // Pass the join date to the user object
    req.userInfos.joinedAt = member.joinedAt;

    // Render the EJS template and pass the user object
    res.render("selector", {
      user: req.userInfos,
      currentURL: `${req.client.config.DASHBOARD.baseURL}/${req.originalUrl}`,
    });
  } catch (error) {
    console.error('Error fetching member data:', error);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
