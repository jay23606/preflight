namespace App.Web
{
    public partial class Checkout : CheckoutBasePage
    {
        private readonly ILogger<Checkout> _logger = LoggerFactory.Create();

        protected void Page_Load(object sender, EventArgs e)
        {
            _logger.LogInformation("checkout opened");
        }
    }
}
